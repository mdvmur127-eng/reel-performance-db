package main

import (
    "bytes"
    "context"
    "crypto/hmac"
    "crypto/rand"
    "crypto/sha256"
    "encoding/base64"
    "encoding/hex"
    "encoding/json"
    "fmt"
    "io"
    "log"
    "net/http"
    "net/url"
    "os"
    "strconv"
    "strings"
    "sync"
    "time"
)

const (
    graphVersion               = "v21.0"
    oauthStateTTLSeconds       = 10 * 60
    pendingSelectionTTLSeconds = 15 * 60
    graphTimeout               = 15 * time.Second
    pendingSelectionCookieName = "meta_ig_pending_selection"
)

var (
    metricTextFields = []string{"url", "top_source_of_views", "audience_country", "audience_age"}
    metricNumericFields = func() []string {
        fields := []string{
            "views",
            "likes",
            "comments",
            "saves",
            "shares",
            "follows",
            "watch_time",
            "duration",
            "views_followers",
            "views_non_followers",
            "accounts_reached",
            "this_reels_skip_rate",
            "typical_skip_rate",
            "average_watch_time",
            "audience_men",
            "audience_women",
        }

        for i := 0; i <= 90; i++ {
            fields = append(fields, fmt.Sprintf("sec_%d", i))
        }

        return fields
    }()
    metaScopes = []string{
        "instagram_basic",
        "instagram_manage_insights",
        "pages_show_list",
        "pages_read_engagement",
    }
)

type App struct {
    client                 *http.Client
    nodeEnv                string
    supabaseBaseURL        string
    supabaseServiceRoleKey string
    metaAppID              string
    metaAppSecret          string
    metaRedirectURI        string
    metaSyncLimit          int
    metaSyncLimitSet       bool
    metaInsightConcurrency int
    metaFetchInsights      bool
}

type graphErrorResponse struct {
    Error *struct {
        Message string `json:"message"`
    } `json:"error"`
}

type InstagramAccountOption struct {
    IGUserID string  `json:"igUserId"`
    Username *string `json:"username"`
    PageID   string  `json:"pageId"`
    PageName *string `json:"pageName"`
}

type pendingSelection struct {
    AccessToken   string                  `json:"accessToken"`
    TokenExpires  *string                 `json:"tokenExpiresAt"`
    CreatedAt     int64                   `json:"createdAt"`
    Accounts      []InstagramAccountOption `json:"accounts"`
}

type MetaConnection struct {
    IGUserID      string  `json:"ig_user_id"`
    IGUsername    *string `json:"ig_username"`
    AccessToken   string  `json:"access_token"`
    TokenExpires  *string `json:"token_expires_at"`
    UpdatedAt     *string `json:"updated_at"`
}

type InstagramMedia struct {
    ID               string   `json:"id"`
    Caption          string   `json:"caption"`
    MediaType        string   `json:"media_type"`
    MediaProductType string   `json:"media_product_type"`
    Permalink        string   `json:"permalink"`
    Timestamp        string   `json:"timestamp"`
    LikeCount        *float64 `json:"like_count"`
    CommentsCount    *float64 `json:"comments_count"`
}

type ReelInsights struct {
    Plays  *float64
    Reach  *float64
    Saved  *float64
    Shares *float64
}

func main() {
    app, err := newApp()
    if err != nil {
        log.Fatalf("failed to init go backend: %v", err)
    }

    mux := http.NewServeMux()
    mux.HandleFunc("/api/metrics", app.handleMetrics)
    mux.HandleFunc("/api/meta/auth/start", app.handleMetaAuthStart)
    mux.HandleFunc("/api/meta/auth/callback", app.handleMetaAuthCallback)
    mux.HandleFunc("/api/meta/status", app.handleMetaStatus)
    mux.HandleFunc("/api/meta/sync", app.handleMetaSync)
    mux.HandleFunc("/api/meta/pending", app.handleMetaPending)
    mux.HandleFunc("/api/meta/select", app.handleMetaSelect)
    mux.HandleFunc("/api/meta/disconnect", app.handleMetaDisconnect)
    mux.HandleFunc("/api/meta/switch/accounts", app.handleMetaSwitchAccounts)
    mux.HandleFunc("/api/meta/switch/select", app.handleMetaSwitchSelect)

    addr := os.Getenv("GO_SERVER_ADDR")
    if addr == "" {
        addr = ":8080"
    }

    log.Printf("go backend listening on %s", addr)
    if err := http.ListenAndServe(addr, mux); err != nil {
        log.Fatal(err)
    }
}

func newApp() (*App, error) {
    supabaseBaseURL := strings.TrimRight(os.Getenv("NEXT_PUBLIC_SUPABASE_URL"), "/")
    if supabaseBaseURL == "" {
        supabaseBaseURL = strings.TrimRight(os.Getenv("SUPABASE_URL"), "/")
    }

    if supabaseBaseURL == "" {
        return nil, fmt.Errorf("missing NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)")
    }

    serviceRole := strings.TrimSpace(os.Getenv("SUPABASE_SERVICE_ROLE_KEY"))
    if serviceRole == "" {
        return nil, fmt.Errorf("missing SUPABASE_SERVICE_ROLE_KEY")
    }

    syncLimitRaw, syncLimitSet := os.LookupEnv("META_SYNC_LIMIT")
    syncLimit := 0
    if syncLimitSet {
        parsed, err := strconv.Atoi(strings.TrimSpace(syncLimitRaw))
        if err != nil {
            return nil, fmt.Errorf("invalid META_SYNC_LIMIT: %w", err)
        }
        syncLimit = parsed
    }

    insightConc := 5
    if raw := strings.TrimSpace(os.Getenv("META_INSIGHT_CONCURRENCY")); raw != "" {
        parsed, err := strconv.Atoi(raw)
        if err != nil {
            return nil, fmt.Errorf("invalid META_INSIGHT_CONCURRENCY: %w", err)
        }
        insightConc = parsed
    }

    return &App{
        client:                 &http.Client{Timeout: 60 * time.Second},
        nodeEnv:                strings.TrimSpace(os.Getenv("NODE_ENV")),
        supabaseBaseURL:        supabaseBaseURL,
        supabaseServiceRoleKey: serviceRole,
        metaAppID:              strings.TrimSpace(os.Getenv("META_APP_ID")),
        metaAppSecret:          strings.TrimSpace(os.Getenv("META_APP_SECRET")),
        metaRedirectURI:        strings.TrimSpace(os.Getenv("META_REDIRECT_URI")),
        metaSyncLimit:          syncLimit,
        metaSyncLimitSet:       syncLimitSet,
        metaInsightConcurrency: insightConc,
        metaFetchInsights:      strings.EqualFold(strings.TrimSpace(os.Getenv("META_FETCH_INSIGHTS")), "true"),
    }, nil
}

func (a *App) handleMetrics(w http.ResponseWriter, r *http.Request) {
    switch r.Method {
    case http.MethodGet:
        a.handleMetricsGet(w, r)
    case http.MethodPost:
        a.handleMetricsPost(w, r)
    case http.MethodPatch:
        a.handleMetricsPatch(w, r)
    default:
        methodNotAllowed(w)
    }
}

func (a *App) handleMetricsGet(w http.ResponseWriter, r *http.Request) {
    query := url.Values{}
    query.Set("select", "*")
    query.Set("order", "date.desc,created_at.desc")
    query.Set("limit", "200")

    body, status, err := a.supabaseRequest(r.Context(), http.MethodGet, "/reel_metrics", query, nil, "")
    if err != nil {
        writeError(w, status, err.Error())
        return
    }

    wrapped, marshalErr := json.Marshal(map[string]json.RawMessage{
        "data": json.RawMessage(body),
    })
    if marshalErr != nil {
        writeError(w, http.StatusInternalServerError, marshalErr.Error())
        return
    }

    writeRawJSON(w, http.StatusOK, wrapped)
}

func (a *App) handleMetricsPost(w http.ResponseWriter, r *http.Request) {
    payloadMap, err := decodeJSONMap(r)
    if err != nil {
        writeError(w, http.StatusBadRequest, err.Error())
        return
    }

    date, title, payload := buildMetricPayload(payloadMap)
    if date == "" {
        writeError(w, http.StatusBadRequest, "date is required")
        return
    }
    if title == "" {
        writeError(w, http.StatusBadRequest, "title is required")
        return
    }

    body, status, reqErr := a.supabaseRequest(
        r.Context(),
        http.MethodPost,
        "/reel_metrics",
        nil,
        payload,
        "return=representation",
    )
    if reqErr != nil {
        writeError(w, status, reqErr.Error())
        return
    }

    first, firstErr := firstJSON(body)
    if firstErr != nil {
        writeError(w, http.StatusInternalServerError, firstErr.Error())
        return
    }

    wrapped, marshalErr := json.Marshal(map[string]json.RawMessage{
        "data": first,
    })
    if marshalErr != nil {
        writeError(w, http.StatusInternalServerError, marshalErr.Error())
        return
    }

    writeRawJSON(w, http.StatusCreated, wrapped)
}

func (a *App) handleMetricsPatch(w http.ResponseWriter, r *http.Request) {
    payloadMap, err := decodeJSONMap(r)
    if err != nil {
        writeError(w, http.StatusBadRequest, err.Error())
        return
    }

    id := strings.TrimSpace(stringValue(payloadMap["id"]))
    if id == "" {
        writeError(w, http.StatusBadRequest, "id is required")
        return
    }

    date, title, payload := buildMetricPayload(payloadMap)
    if date == "" {
        writeError(w, http.StatusBadRequest, "date is required")
        return
    }
    if title == "" {
        writeError(w, http.StatusBadRequest, "title is required")
        return
    }

    query := url.Values{}
    query.Set("id", "eq."+id)

    body, status, reqErr := a.supabaseRequest(
        r.Context(),
        http.MethodPatch,
        "/reel_metrics",
        query,
        payload,
        "return=representation",
    )
    if reqErr != nil {
        writeError(w, status, reqErr.Error())
        return
    }

    first, firstErr := firstJSON(body)
    if firstErr != nil {
        writeError(w, http.StatusInternalServerError, firstErr.Error())
        return
    }

    wrapped, marshalErr := json.Marshal(map[string]json.RawMessage{
        "data": first,
    })
    if marshalErr != nil {
        writeError(w, http.StatusInternalServerError, marshalErr.Error())
        return
    }

    writeRawJSON(w, http.StatusOK, wrapped)
}

func (a *App) handleMetaAuthStart(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodGet {
        methodNotAllowed(w)
        return
    }

    if err := a.requireMetaConfig(); err != nil {
        writeError(w, http.StatusInternalServerError, err.Error())
        return
    }

    state, err := a.createOAuthState()
    if err != nil {
        writeError(w, http.StatusInternalServerError, err.Error())
        return
    }

    force := r.URL.Query().Get("force") == "1"
    authURL, err := a.buildAuthURL(state, force)
    if err != nil {
        writeError(w, http.StatusInternalServerError, err.Error())
        return
    }

    http.Redirect(w, r, authURL, http.StatusFound)
}

func (a *App) handleMetaAuthCallback(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodGet {
        methodNotAllowed(w)
        return
    }

    if err := a.requireMetaConfig(); err != nil {
        writeError(w, http.StatusInternalServerError, err.Error())
        return
    }

    query := r.URL.Query()
    code := strings.TrimSpace(query.Get("code"))
    state := strings.TrimSpace(query.Get("state"))
    errorDescription := strings.TrimSpace(query.Get("error_description"))

    if errorDescription != "" {
        a.clearPendingCookie(w)
        http.Redirect(w, r, appRedirectPath("error", errorDescription), http.StatusFound)
        return
    }

    if code == "" || state == "" || !a.verifyOAuthState(state) {
        a.clearPendingCookie(w)
        http.Redirect(w, r, appRedirectPath("error", "Instagram auth state validation failed"), http.StatusFound)
        return
    }

    shortToken, err := a.exchangeCodeForShortToken(code)
    if err != nil {
        a.clearPendingCookie(w)
        http.Redirect(w, r, appRedirectPath("error", err.Error()), http.StatusFound)
        return
    }

    accessToken, expiresIn, err := a.exchangeForLongToken(shortToken)
    if err != nil {
        a.clearPendingCookie(w)
        http.Redirect(w, r, appRedirectPath("error", err.Error()), http.StatusFound)
        return
    }

    accounts, err := a.listInstagramAccounts(accessToken)
    if err != nil {
        a.clearPendingCookie(w)
        http.Redirect(w, r, appRedirectPath("error", err.Error()), http.StatusFound)
        return
    }

    if len(accounts) == 0 {
        a.clearPendingCookie(w)
        http.Redirect(w, r, appRedirectPath("error", "No Instagram business account found for this Meta login"), http.StatusFound)
        return
    }

    var tokenExpiresAt *string
    if expiresIn != nil {
        expiresAt := time.Now().Add(time.Duration(*expiresIn) * time.Second).UTC().Format(time.RFC3339)
        tokenExpiresAt = &expiresAt
    }

    if len(accounts) == 1 {
        single := accounts[0]
        if err := a.saveConnection(single.IGUserID, single.Username, accessToken, tokenExpiresAt); err != nil {
            a.clearPendingCookie(w)
            http.Redirect(w, r, appRedirectPath("error", err.Error()), http.StatusFound)
            return
        }

        a.clearPendingCookie(w)
        http.Redirect(w, r, appRedirectPath("connected", ""), http.StatusFound)
        return
    }

    token, err := a.createPendingSelectionToken(accessToken, tokenExpiresAt, accounts)
    if err != nil {
        a.clearPendingCookie(w)
        http.Redirect(w, r, appRedirectPath("error", err.Error()), http.StatusFound)
        return
    }

    a.setPendingCookie(w, token)
    http.Redirect(w, r, appRedirectPath("choose", ""), http.StatusFound)
}

func (a *App) handleMetaStatus(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodGet {
        methodNotAllowed(w)
        return
    }

    connection, status, err := a.loadMetaConnection(
        r.Context(),
        []string{"ig_user_id", "ig_username", "token_expires_at", "updated_at"},
    )
    if err != nil {
        writeError(w, status, err.Error())
        return
    }

    if connection == nil {
        writeJSON(w, http.StatusOK, map[string]interface{}{
            "connected": false,
            "account":   nil,
        })
        return
    }

    writeJSON(w, http.StatusOK, map[string]interface{}{
        "connected": true,
        "account": map[string]interface{}{
            "ig_user_id":      connection.IGUserID,
            "ig_username":     connection.IGUsername,
            "token_expires_at": connection.TokenExpires,
            "updated_at":      connection.UpdatedAt,
        },
    })
}

func (a *App) handleMetaSync(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        methodNotAllowed(w)
        return
    }

    connection, status, err := a.loadMetaConnection(r.Context(), []string{"ig_user_id", "access_token"})
    if err != nil {
        writeError(w, status, err.Error())
        return
    }

    if connection == nil {
        writeError(w, http.StatusBadRequest, "Instagram is not connected. Click Connect IG first.")
        return
    }

    quickMode := r.URL.Query().Get("quick") == "1"

    syncLimit := a.metaSyncLimit
    if !a.metaSyncLimitSet {
        if quickMode {
            syncLimit = 12
        } else {
            syncLimit = 25
        }
    }
    syncLimit = clamp(syncLimit, 5, 50)

    insightConc := clamp(a.metaInsightConcurrency, 1, 8)
    fetchInsights := a.metaFetchInsights && !quickMode

    reels, err := a.fetchInstagramReels(connection.AccessToken, connection.IGUserID, syncLimit)
    if err != nil {
        writeError(w, http.StatusInternalServerError, err.Error())
        return
    }

    if len(reels) == 0 {
        writeJSON(w, http.StatusOK, map[string]interface{}{
            "imported": 0,
            "scanned":  0,
            "message":  "No reels found on this connected Instagram account",
        })
        return
    }

    rows := make([]map[string]interface{}, 0, len(reels))

    for i := 0; i < len(reels); i += insightConc {
        end := i + insightConc
        if end > len(reels) {
            end = len(reels)
        }

        batch := reels[i:end]
        batchRows := make([]map[string]interface{}, len(batch))

        var wg sync.WaitGroup
        for index, reel := range batch {
            wg.Add(1)
            go func(index int, reel InstagramMedia) {
                defer wg.Done()

                insights := ReelInsights{}
                if fetchInsights {
                    insights = a.fetchReelInsights(connection.AccessToken, reel.ID)
                }

                batchRows[index] = map[string]interface{}{
                    "date":                toDate(reel.Timestamp),
                    "title":               toTitle(reel.Caption, reel.ID),
                    "url":                 nullableString(reel.Permalink),
                    "views":               insights.Plays,
                    "likes":               reel.LikeCount,
                    "comments":            reel.CommentsCount,
                    "saves":               insights.Saved,
                    "shares":              insights.Shares,
                    "accounts_reached":    insights.Reach,
                    "top_source_of_views": "Reels tab",
                }
            }(index, reel)
        }
        wg.Wait()

        rows = append(rows, batchRows...)
    }

    query := url.Values{}
    query.Set("on_conflict", "date,title,url")

    _, upsertStatus, upsertErr := a.supabaseRequest(
        r.Context(),
        http.MethodPost,
        "/reel_metrics",
        query,
        rows,
        "resolution=merge-duplicates",
    )
    if upsertErr != nil {
        writeError(w, upsertStatus, upsertErr.Error())
        return
    }

    message := ""
    if fetchInsights {
        message = fmt.Sprintf("Synced %d reels with insights", len(rows))
    } else {
        message = fmt.Sprintf("Synced %d reels (quick mode, insights skipped)", len(rows))
    }

    writeJSON(w, http.StatusOK, map[string]interface{}{
        "imported": len(rows),
        "scanned":  len(reels),
        "message":  message,
    })
}

func (a *App) handleMetaPending(w http.ResponseWriter, r *http.Request) {
    switch r.Method {
    case http.MethodGet:
        cookie, err := r.Cookie(pendingSelectionCookieName)
        if err != nil || strings.TrimSpace(cookie.Value) == "" {
            writeJSON(w, http.StatusOK, map[string]interface{}{"pending": false, "accounts": []interface{}{}})
            return
        }

        parsed, ok := a.verifyPendingSelectionToken(cookie.Value)
        if !ok {
            a.clearPendingCookie(w)
            writeJSON(w, http.StatusOK, map[string]interface{}{"pending": false, "accounts": []interface{}{}})
            return
        }

        writeJSON(w, http.StatusOK, map[string]interface{}{
            "pending":  true,
            "accounts": parsed.Accounts,
        })
    case http.MethodDelete:
        a.clearPendingCookie(w)
        writeJSON(w, http.StatusOK, map[string]interface{}{"ok": true})
    default:
        methodNotAllowed(w)
    }
}

func (a *App) handleMetaSelect(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        methodNotAllowed(w)
        return
    }

    cookie, err := r.Cookie(pendingSelectionCookieName)
    if err != nil || strings.TrimSpace(cookie.Value) == "" {
        writeError(w, http.StatusBadRequest, "No pending Instagram account selection found")
        return
    }

    parsed, ok := a.verifyPendingSelectionToken(cookie.Value)
    if !ok {
        a.clearPendingCookie(w)
        writeError(w, http.StatusBadRequest, "Pending selection expired. Please connect Instagram again.")
        return
    }

    payload, decodeErr := decodeJSONMap(r)
    if decodeErr != nil {
        writeError(w, http.StatusBadRequest, decodeErr.Error())
        return
    }

    igUserID := strings.TrimSpace(stringValue(payload["igUserId"]))
    if igUserID == "" {
        writeError(w, http.StatusBadRequest, "igUserId is required")
        return
    }

    var selected *InstagramAccountOption
    for _, account := range parsed.Accounts {
        if account.IGUserID == igUserID {
            accountCopy := account
            selected = &accountCopy
            break
        }
    }

    if selected == nil {
        writeError(w, http.StatusBadRequest, "Selected Instagram account is not available in this session")
        return
    }

    if err := a.saveConnection(selected.IGUserID, selected.Username, parsed.AccessToken, parsed.TokenExpires); err != nil {
        writeError(w, http.StatusInternalServerError, err.Error())
        return
    }

    a.clearPendingCookie(w)
    writeJSON(w, http.StatusOK, map[string]interface{}{
        "connected": true,
        "account":   selected,
    })
}

func (a *App) handleMetaDisconnect(w http.ResponseWriter, r *http.Request) {
    switch r.Method {
    case http.MethodPost:
        if err := a.disconnectCurrentConnection(r.Context()); err != nil {
            writeError(w, http.StatusInternalServerError, err.Error())
            return
        }
        writeJSON(w, http.StatusOK, map[string]interface{}{"disconnected": true})
    case http.MethodGet:
        if err := a.disconnectCurrentConnection(r.Context()); err != nil {
            http.Redirect(w, r, appRedirectPath("error", err.Error()), http.StatusFound)
            return
        }
        http.Redirect(w, r, "/api/meta/auth/start", http.StatusFound)
    default:
        methodNotAllowed(w)
    }
}

func (a *App) handleMetaSwitchAccounts(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodGet {
        methodNotAllowed(w)
        return
    }

    connection, status, err := a.loadMetaConnection(r.Context(), []string{"ig_user_id", "access_token"})
    if err != nil {
        writeError(w, status, err.Error())
        return
    }

    if connection == nil {
        writeError(w, http.StatusBadRequest, "Instagram is not connected. Click Connect IG first.")
        return
    }

    accounts, listErr := a.listInstagramAccounts(connection.AccessToken)
    if listErr != nil {
        writeError(w, http.StatusInternalServerError, listErr.Error())
        return
    }

    writeJSON(w, http.StatusOK, map[string]interface{}{
        "connectedIgUserId": connection.IGUserID,
        "accounts":          accounts,
    })
}

func (a *App) handleMetaSwitchSelect(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        methodNotAllowed(w)
        return
    }

    payload, decodeErr := decodeJSONMap(r)
    if decodeErr != nil {
        writeError(w, http.StatusBadRequest, decodeErr.Error())
        return
    }

    igUserID := strings.TrimSpace(stringValue(payload["igUserId"]))
    if igUserID == "" {
        writeError(w, http.StatusBadRequest, "igUserId is required")
        return
    }

    connection, status, err := a.loadMetaConnection(r.Context(), []string{"access_token", "token_expires_at"})
    if err != nil {
        writeError(w, status, err.Error())
        return
    }

    if connection == nil {
        writeError(w, http.StatusBadRequest, "Instagram is not connected. Click Connect IG first.")
        return
    }

    accounts, listErr := a.listInstagramAccounts(connection.AccessToken)
    if listErr != nil {
        writeError(w, http.StatusInternalServerError, listErr.Error())
        return
    }

    var selected *InstagramAccountOption
    for _, account := range accounts {
        if account.IGUserID == igUserID {
            accountCopy := account
            selected = &accountCopy
            break
        }
    }

    if selected == nil {
        writeError(w, http.StatusBadRequest, "Selected Instagram account is not available for this connection")
        return
    }

    if err := a.saveConnection(selected.IGUserID, selected.Username, connection.AccessToken, connection.TokenExpires); err != nil {
        writeError(w, http.StatusInternalServerError, err.Error())
        return
    }

    writeJSON(w, http.StatusOK, map[string]interface{}{
        "connected": true,
        "account":   selected,
    })
}

func (a *App) supabaseRequest(
    ctx context.Context,
    method string,
    path string,
    query url.Values,
    body interface{},
    prefer string,
) ([]byte, int, error) {
    endpoint := a.supabaseBaseURL + "/rest/v1" + path
    parsed, err := url.Parse(endpoint)
    if err != nil {
        return nil, http.StatusInternalServerError, err
    }

    if query != nil {
        parsed.RawQuery = query.Encode()
    }

    var bodyReader io.Reader
    if body != nil {
        payload, marshalErr := json.Marshal(body)
        if marshalErr != nil {
            return nil, http.StatusBadRequest, marshalErr
        }
        bodyReader = bytes.NewReader(payload)
    }

    req, reqErr := http.NewRequestWithContext(ctx, method, parsed.String(), bodyReader)
    if reqErr != nil {
        return nil, http.StatusInternalServerError, reqErr
    }

    req.Header.Set("apikey", a.supabaseServiceRoleKey)
    req.Header.Set("Authorization", "Bearer "+a.supabaseServiceRoleKey)
    req.Header.Set("Accept", "application/json")

    if body != nil {
        req.Header.Set("Content-Type", "application/json")
    }

    if prefer != "" {
        req.Header.Set("Prefer", prefer)
    }

    resp, doErr := a.client.Do(req)
    if doErr != nil {
        return nil, http.StatusBadGateway, doErr
    }
    defer resp.Body.Close()

    responseBody, readErr := io.ReadAll(resp.Body)
    if readErr != nil {
        return nil, http.StatusBadGateway, readErr
    }

    if resp.StatusCode >= 400 {
        message := parseSupabaseError(responseBody, resp.StatusCode)
        return nil, resp.StatusCode, fmt.Errorf("%s", message)
    }

    if len(responseBody) == 0 {
        responseBody = []byte("[]")
    }

    return responseBody, resp.StatusCode, nil
}

func (a *App) requireMetaConfig() error {
    if strings.TrimSpace(a.metaAppID) == "" {
        return fmt.Errorf("missing META_APP_ID")
    }
    if strings.TrimSpace(a.metaAppSecret) == "" {
        return fmt.Errorf("missing META_APP_SECRET")
    }
    if strings.TrimSpace(a.metaRedirectURI) == "" {
        return fmt.Errorf("missing META_REDIRECT_URI")
    }
    return nil
}

func (a *App) buildAuthURL(state string, forceRerequest bool) (string, error) {
    if err := a.requireMetaConfig(); err != nil {
        return "", err
    }

    authURL := url.URL{
        Scheme: "https",
        Host:   "www.facebook.com",
        Path:   "/" + graphVersion + "/dialog/oauth",
    }

    params := url.Values{}
    params.Set("client_id", a.metaAppID)
    params.Set("redirect_uri", a.metaRedirectURI)
    params.Set("state", state)
    params.Set("response_type", "code")
    params.Set("scope", strings.Join(metaScopes, ","))
    if forceRerequest {
        params.Set("auth_type", "rerequest")
    }
    authURL.RawQuery = params.Encode()

    return authURL.String(), nil
}

func (a *App) createOAuthState() (string, error) {
    nonce, err := randomHex(16)
    if err != nil {
        return "", err
    }

    timestamp := time.Now().Unix()
    payload := fmt.Sprintf("%d.%s", timestamp, nonce)
    signature := hmacHex(payload, a.metaAppSecret)
    return payload + "." + signature, nil
}

func (a *App) verifyOAuthState(state string) bool {
    if err := a.requireMetaConfig(); err != nil {
        return false
    }

    parts := strings.Split(state, ".")
    if len(parts) != 3 {
        return false
    }

    tsRaw := strings.TrimSpace(parts[0])
    nonce := strings.TrimSpace(parts[1])
    signature := strings.TrimSpace(parts[2])

    if tsRaw == "" || nonce == "" || signature == "" {
        return false
    }

    ts, err := strconv.ParseInt(tsRaw, 10, 64)
    if err != nil {
        return false
    }

    now := time.Now().Unix()
    age := now - ts
    if age < -60 || age > oauthStateTTLSeconds {
        return false
    }

    expected := hmacHex(tsRaw+"."+nonce, a.metaAppSecret)
    return hmac.Equal([]byte(expected), []byte(signature))
}

func (a *App) createPendingSelectionToken(accessToken string, tokenExpires *string, accounts []InstagramAccountOption) (string, error) {
    if err := a.requireMetaConfig(); err != nil {
        return "", err
    }

    payload := pendingSelection{
        AccessToken:  accessToken,
        TokenExpires: tokenExpires,
        CreatedAt:    time.Now().Unix(),
        Accounts:     accounts,
    }

    payloadJSON, err := json.Marshal(payload)
    if err != nil {
        return "", err
    }

    encoded := base64.RawURLEncoding.EncodeToString(payloadJSON)
    signature := hmacHex(encoded, a.metaAppSecret)
    return encoded + "." + signature, nil
}

func (a *App) verifyPendingSelectionToken(token string) (*pendingSelection, bool) {
    if err := a.requireMetaConfig(); err != nil {
        return nil, false
    }

    parts := strings.Split(token, ".")
    if len(parts) != 2 {
        return nil, false
    }

    encoded := strings.TrimSpace(parts[0])
    signature := strings.TrimSpace(parts[1])
    if encoded == "" || signature == "" {
        return nil, false
    }

    expected := hmacHex(encoded, a.metaAppSecret)
    if !hmac.Equal([]byte(expected), []byte(signature)) {
        return nil, false
    }

    decoded, err := base64.RawURLEncoding.DecodeString(encoded)
    if err != nil {
        return nil, false
    }

    var parsed pendingSelection
    if err := json.Unmarshal(decoded, &parsed); err != nil {
        return nil, false
    }

    if parsed.CreatedAt == 0 {
        return nil, false
    }

    age := time.Now().Unix() - parsed.CreatedAt
    if age < 0 || age > pendingSelectionTTLSeconds {
        return nil, false
    }

    if strings.TrimSpace(parsed.AccessToken) == "" || len(parsed.Accounts) == 0 {
        return nil, false
    }

    return &parsed, true
}

func (a *App) exchangeCodeForShortToken(code string) (string, error) {
    response := struct {
        AccessToken string `json:"access_token"`
    }{}

    params := url.Values{}
    params.Set("client_id", a.metaAppID)
    params.Set("client_secret", a.metaAppSecret)
    params.Set("redirect_uri", a.metaRedirectURI)
    params.Set("code", code)

    if err := a.graphGet("/oauth/access_token", params, &response); err != nil {
        return "", err
    }

    if strings.TrimSpace(response.AccessToken) == "" {
        return "", fmt.Errorf("Meta OAuth did not return an access token")
    }

    return response.AccessToken, nil
}

func (a *App) exchangeForLongToken(shortToken string) (string, *int, error) {
    response := struct {
        AccessToken string `json:"access_token"`
        ExpiresIn   *int   `json:"expires_in"`
    }{}

    params := url.Values{}
    params.Set("grant_type", "fb_exchange_token")
    params.Set("client_id", a.metaAppID)
    params.Set("client_secret", a.metaAppSecret)
    params.Set("fb_exchange_token", shortToken)

    if err := a.graphGet("/oauth/access_token", params, &response); err != nil {
        return "", nil, err
    }

    if strings.TrimSpace(response.AccessToken) == "" {
        return "", nil, fmt.Errorf("failed to get a long-lived Meta access token")
    }

    return response.AccessToken, response.ExpiresIn, nil
}

func (a *App) listInstagramAccounts(accessToken string) ([]InstagramAccountOption, error) {
    response := struct {
        Data []struct {
            ID                         string  `json:"id"`
            Name                       *string `json:"name"`
            InstagramBusinessAccount   *struct {
                ID       string  `json:"id"`
                Username *string `json:"username"`
            } `json:"instagram_business_account"`
            ConnectedInstagramAccount *struct {
                ID       string  `json:"id"`
                Username *string `json:"username"`
            } `json:"connected_instagram_account"`
        } `json:"data"`
    }{}

    params := url.Values{}
    params.Set("access_token", accessToken)
    params.Set("fields", "id,name,instagram_business_account{id,username},connected_instagram_account{id,username}")
    params.Set("limit", "50")

    if err := a.graphGet("/me/accounts", params, &response); err != nil {
        return nil, err
    }

    dedupe := map[string]bool{}
    accounts := make([]InstagramAccountOption, 0)

    for _, page := range response.Data {
        candidate := page.InstagramBusinessAccount
        if candidate == nil {
            candidate = page.ConnectedInstagramAccount
        }

        if candidate == nil || strings.TrimSpace(candidate.ID) == "" {
            continue
        }

        if dedupe[candidate.ID] {
            continue
        }
        dedupe[candidate.ID] = true

        pageName := page.Name
        accounts = append(accounts, InstagramAccountOption{
            IGUserID: candidate.ID,
            Username: candidate.Username,
            PageID:   page.ID,
            PageName: pageName,
        })
    }

    return accounts, nil
}

func (a *App) fetchInstagramReels(accessToken, igUserID string, maxItems int) ([]InstagramMedia, error) {
    reels := make([]InstagramMedia, 0, maxItems)

    nextURL := url.URL{
        Scheme: "https",
        Host:   "graph.facebook.com",
        Path:   "/" + graphVersion + "/" + igUserID + "/media",
    }

    query := url.Values{}
    query.Set("access_token", accessToken)
    query.Set("fields", "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count")
    query.Set("limit", strconv.Itoa(clamp(maxItems, 10, 50)))
    nextURL.RawQuery = query.Encode()

    for safety := 0; safety < 10 && len(reels) < maxItems; safety++ {
        response := struct {
            Data   []InstagramMedia `json:"data"`
            Paging *struct {
                Next string `json:"next"`
            } `json:"paging"`
        }{}

        if err := a.graphGetByURL(nextURL.String(), nil, &response); err != nil {
            return nil, err
        }

        for _, item := range response.Data {
            if item.MediaProductType == "REELS" || item.MediaType == "VIDEO" {
                reels = append(reels, item)
                if len(reels) >= maxItems {
                    break
                }
            }
        }

        if response.Paging == nil || strings.TrimSpace(response.Paging.Next) == "" {
            break
        }

        parsedNextURL, parseErr := url.Parse(response.Paging.Next)
        if parseErr != nil {
            break
        }
        nextURL = *parsedNextURL
    }

    return reels, nil
}

func (a *App) fetchReelInsights(accessToken, mediaID string) ReelInsights {
    result := ReelInsights{}

    response := struct {
        Data []struct {
            Name   string `json:"name"`
            Values []struct {
                Value *float64 `json:"value"`
            } `json:"values"`
        } `json:"data"`
    }{}

    params := url.Values{}
    params.Set("access_token", accessToken)
    params.Set("metric", "plays,reach,saved,shares")
    params.Set("period", "lifetime")

    if err := a.graphGet("/"+mediaID+"/insights", params, &response); err != nil {
        return result
    }

    for _, metric := range response.Data {
        if len(metric.Values) == 0 || metric.Values[0].Value == nil {
            continue
        }

        value := metric.Values[0].Value
        switch metric.Name {
        case "plays":
            result.Plays = value
        case "reach":
            result.Reach = value
        case "saved":
            result.Saved = value
        case "shares":
            result.Shares = value
        }
    }

    return result
}

func (a *App) graphGet(path string, params url.Values, out interface{}) error {
    fullURL := fmt.Sprintf("https://graph.facebook.com/%s%s", graphVersion, path)
    return a.graphGetByURL(fullURL, params, out)
}

func (a *App) graphGetByURL(fullURL string, params url.Values, out interface{}) error {
    parsedURL, err := url.Parse(fullURL)
    if err != nil {
        return err
    }

    if params != nil {
        query := parsedURL.Query()
        for key, values := range params {
            for _, value := range values {
                query.Set(key, value)
            }
        }
        parsedURL.RawQuery = query.Encode()
    }

    ctx, cancel := context.WithTimeout(context.Background(), graphTimeout)
    defer cancel()

    req, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, parsedURL.String(), nil)
    if reqErr != nil {
        return reqErr
    }

    req.Header.Set("Accept", "application/json")

    resp, doErr := a.client.Do(req)
    if doErr != nil {
        return doErr
    }
    defer resp.Body.Close()

    body, readErr := io.ReadAll(resp.Body)
    if readErr != nil {
        return readErr
    }

    if resp.StatusCode >= 400 {
        return fmt.Errorf("%s", parseGraphError(body, resp.StatusCode))
    }

    if err := json.Unmarshal(body, out); err != nil {
        return err
    }

    return nil
}

func (a *App) loadMetaConnection(ctx context.Context, selectFields []string) (*MetaConnection, int, error) {
    query := url.Values{}
    query.Set("id", "eq.1")
    query.Set("select", strings.Join(selectFields, ","))

    body, status, err := a.supabaseRequest(ctx, http.MethodGet, "/meta_instagram_connections", query, nil, "")
    if err != nil {
        return nil, status, err
    }

    var connections []MetaConnection
    if unmarshalErr := json.Unmarshal(body, &connections); unmarshalErr != nil {
        return nil, http.StatusInternalServerError, unmarshalErr
    }

    if len(connections) == 0 {
        return nil, 0, nil
    }

    return &connections[0], 0, nil
}

func (a *App) saveConnection(igUserID string, igUsername *string, accessToken string, tokenExpires *string) error {
    query := url.Values{}
    query.Set("on_conflict", "id")

    payload := map[string]interface{}{
        "id":              1,
        "ig_user_id":      igUserID,
        "ig_username":     igUsername,
        "access_token":    accessToken,
        "token_expires_at": tokenExpires,
    }

    _, _, err := a.supabaseRequest(
        context.Background(),
        http.MethodPost,
        "/meta_instagram_connections",
        query,
        payload,
        "resolution=merge-duplicates",
    )
    return err
}

func (a *App) disconnectCurrentConnection(ctx context.Context) error {
    query := url.Values{}
    query.Set("id", "eq.1")

    _, _, err := a.supabaseRequest(ctx, http.MethodDelete, "/meta_instagram_connections", query, nil, "")
    return err
}

func (a *App) setPendingCookie(w http.ResponseWriter, token string) {
    http.SetCookie(w, &http.Cookie{
        Name:     pendingSelectionCookieName,
        Value:    token,
        Path:     "/",
        HttpOnly: true,
        Secure:   strings.EqualFold(a.nodeEnv, "production"),
        SameSite: http.SameSiteLaxMode,
        MaxAge:   pendingSelectionTTLSeconds,
    })
}

func (a *App) clearPendingCookie(w http.ResponseWriter) {
    http.SetCookie(w, &http.Cookie{
        Name:     pendingSelectionCookieName,
        Value:    "",
        Path:     "/",
        HttpOnly: true,
        Secure:   strings.EqualFold(a.nodeEnv, "production"),
        SameSite: http.SameSiteLaxMode,
        MaxAge:   -1,
    })
}

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
    bytes, err := json.Marshal(payload)
    if err != nil {
        writeError(w, http.StatusInternalServerError, err.Error())
        return
    }

    writeRawJSON(w, status, bytes)
}

func writeRawJSON(w http.ResponseWriter, status int, payload []byte) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(status)
    _, _ = w.Write(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
    if status == 0 {
        status = http.StatusInternalServerError
    }
    writeJSON(w, status, map[string]string{"error": message})
}

func methodNotAllowed(w http.ResponseWriter) {
    writeError(w, http.StatusMethodNotAllowed, "method not allowed")
}

func decodeJSONMap(r *http.Request) (map[string]interface{}, error) {
    defer r.Body.Close()
    decoder := json.NewDecoder(r.Body)
    decoder.UseNumber()

    payload := map[string]interface{}{}
    if err := decoder.Decode(&payload); err != nil {
        return nil, fmt.Errorf("invalid JSON payload")
    }

    return payload, nil
}

func buildMetricPayload(body map[string]interface{}) (string, string, map[string]interface{}) {
    date := strings.TrimSpace(stringValue(body["date"]))
    title := strings.TrimSpace(stringValue(body["title"]))

    payload := map[string]interface{}{
        "date":  date,
        "title": title,
    }

    for _, field := range metricTextFields {
        raw, exists := body[field]
        if !exists || raw == nil {
            payload[field] = nil
            continue
        }

        value := strings.TrimSpace(stringValue(raw))
        if value == "" {
            payload[field] = nil
        } else {
            payload[field] = value
        }
    }

    for _, field := range metricNumericFields {
        payload[field] = nullableNumber(body[field])
    }

    return date, title, payload
}

func nullableNumber(raw interface{}) interface{} {
    if raw == nil {
        return nil
    }

    switch value := raw.(type) {
    case json.Number:
        parsed, err := value.Float64()
        if err != nil {
            return nil
        }
        return parsed
    case float64:
        return value
    case float32:
        return float64(value)
    case int:
        return float64(value)
    case int64:
        return float64(value)
    case int32:
        return float64(value)
    case string:
        trimmed := strings.TrimSpace(value)
        if trimmed == "" {
            return nil
        }
        parsed, err := strconv.ParseFloat(trimmed, 64)
        if err != nil {
            return nil
        }
        return parsed
    default:
        return nil
    }
}

func stringValue(raw interface{}) string {
    switch value := raw.(type) {
    case nil:
        return ""
    case string:
        return value
    case json.Number:
        return value.String()
    case float64:
        return strconv.FormatFloat(value, 'f', -1, 64)
    case float32:
        return strconv.FormatFloat(float64(value), 'f', -1, 64)
    case int:
        return strconv.Itoa(value)
    case int64:
        return strconv.FormatInt(value, 10)
    default:
        return fmt.Sprintf("%v", value)
    }
}

func firstJSON(body []byte) (json.RawMessage, error) {
    var rows []json.RawMessage
    if err := json.Unmarshal(body, &rows); err != nil {
        return nil, err
    }

    if len(rows) == 0 {
        return nil, fmt.Errorf("empty response from database")
    }

    return rows[0], nil
}

func parseSupabaseError(body []byte, status int) string {
    fallback := fmt.Sprintf("Supabase request failed with status %d", status)
    if len(body) == 0 {
        return fallback
    }

    var parsed map[string]interface{}
    if err := json.Unmarshal(body, &parsed); err != nil {
        return fallback
    }

    for _, key := range []string{"message", "error", "hint", "details"} {
        if value, ok := parsed[key].(string); ok && strings.TrimSpace(value) != "" {
            return value
        }
    }

    return fallback
}

func parseGraphError(body []byte, status int) string {
    fallback := fmt.Sprintf("Graph API request failed with status %d", status)
    if len(body) == 0 {
        return fallback
    }

    var parsed graphErrorResponse
    if err := json.Unmarshal(body, &parsed); err != nil {
        return fallback
    }

    if parsed.Error != nil && strings.TrimSpace(parsed.Error.Message) != "" {
        return parsed.Error.Message
    }

    return fallback
}

func appRedirectPath(status string, message string) string {
    query := url.Values{}
    query.Set("ig", status)

    if strings.TrimSpace(message) != "" {
        msg := strings.TrimSpace(message)
        if len(msg) > 180 {
            msg = msg[:180]
        }
        query.Set("ig_message", msg)
    }

    return "/?" + query.Encode()
}

func randomHex(bytesCount int) (string, error) {
    buf := make([]byte, bytesCount)
    if _, err := rand.Read(buf); err != nil {
        return "", err
    }
    return hex.EncodeToString(buf), nil
}

func hmacHex(value, secret string) string {
    hasher := hmac.New(sha256.New, []byte(secret))
    _, _ = hasher.Write([]byte(value))
    return hex.EncodeToString(hasher.Sum(nil))
}

func clamp(value, min, max int) int {
    if value < min {
        return min
    }
    if value > max {
        return max
    }
    return value
}

func toDate(timestamp string) string {
    if len(strings.TrimSpace(timestamp)) >= 10 {
        return strings.TrimSpace(timestamp)[:10]
    }
    return time.Now().UTC().Format("2006-01-02")
}

func toTitle(caption string, mediaID string) string {
    trimmed := strings.TrimSpace(caption)
    if trimmed != "" {
        firstLine := strings.Split(trimmed, "\n")[0]
        if len(firstLine) > 200 {
            firstLine = firstLine[:200]
        }
        if strings.TrimSpace(firstLine) != "" {
            return firstLine
        }
    }

    suffix := mediaID
    if len(suffix) > 8 {
        suffix = suffix[len(suffix)-8:]
    }
    return "Reel " + suffix
}

func nullableString(value string) interface{} {
    trimmed := strings.TrimSpace(value)
    if trimmed == "" {
        return nil
    }
    return trimmed
}
