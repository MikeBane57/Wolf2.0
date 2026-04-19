// ==UserScript==
// @name         SOD Wall of Fame
// @namespace    Wolf 2.0
// @version      2.6.1
// @description  FIMS tab: Wall of Fame; data from WALL of FAME/wall-of-fame.json + local cache (no baked-in accolades)
// @match        https://opssuitemain.swacorp.com/*
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @connect      *
// @donkeycode-pref {"wallOfFameShowTab":{"type":"boolean","group":"Wall of Fame","label":"Show Wall of Fame tab","description":"Tab next to FIMS / Advisories on the FIMS widget.","default":true},"wallOfFameUseGithubActions":{"type":"boolean","group":"Wall of Fame — GitHub Actions","label":"Use Actions + repo secret","description":"If on: fetch from raw.githubusercontent.com; publish via repository_dispatch. Set repo secret WOF_TEAM_KEY to match wallOfFameTeamKey. Publish still needs donkeycode_github_pat to trigger the workflow.","default":false},"wallOfFameTeamKey":{"type":"string","group":"Wall of Fame — GitHub Actions","label":"Team key (matches WOF_TEAM_KEY)","description":"Same value as repository secret WOF_TEAM_KEY (Settings → Secrets). Not the GitHub PAT.","default":"","placeholder":""},"wallOfFameRepoPath":{"type":"string","group":"Wall of Fame — GitHub Actions","label":"JSON path in repo (optional)","description":"Path to wall-of-fame.json in Wolf2.0, e.g. WALL of FAME/wall-of-fame.json. Leave empty for default. Do not use session sync folder unless your file lives there.","default":"","placeholder":"WALL of FAME/wall-of-fame.json"},"wallOfFameProxyUrl":{"type":"url","group":"Wall of Fame — team proxy","label":"Proxy base URL (optional)","description":"HTTPS URL of wall-of-fame-proxy. If set with team key, overrides Actions mode for sync.","default":"","placeholder":"https://wof.example.com"}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/SOD%20Wall%20of%20Fame.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/SOD%20Wall%20of%20Fame.user.js
// ==/UserScript==

(function() {
    'use strict';

    var TABLE_ID = 'fims-id';
    var TAB_ID = 'dc-wof-tab';
    var PANEL_ID = 'dc-wof-panel';
    var TCP_PANEL_ID = 'dc-fims-top-clickers-panel';
    var STYLE_ID = 'dc-wof-style';

    /** Defaults when DonkeyCODE session-sync prefs are absent (getPref('donkeycode_github_*')). */
    var GITHUB_OWNER = 'MikeBane57';
    var GITHUB_REPO = 'Wolf2.0';
    var GITHUB_BRANCH = 'main';
    /** Repo path when sessions root is empty; else file is {sessionsRoot}/wall-of-fame.json */
    var WALL_OF_FAME_FILE_PATH = 'WALL of FAME/wall-of-fame.json';

    /**
     * Same PAT/repo/branch as DonkeyCODE “GitHub session sync” (extension settings).
     * Injected getPref must expose donkeycode_github_* (same keys as chrome.storage.local).
     * No separate userscript PAT — use extension settings only.
     */
    function resolvedGithubPat() {
        return String(getPref('donkeycode_github_pat', '') || '').trim();
    }

    function resolvedGithubOwner() {
        var o = String(getPref('donkeycode_github_owner', '') || '').trim();
        return o || GITHUB_OWNER;
    }

    function resolvedGithubRepo() {
        var r = String(getPref('donkeycode_github_repo', '') || '').trim();
        return r || GITHUB_REPO;
    }

    function resolvedGithubBranch() {
        var b = String(getPref('donkeycode_github_branch', '') || '').trim();
        return b || GITHUB_BRANCH;
    }

    /**
     * Path to wall-of-fame.json in the repo. Not derived from donkeycode_github_sessions_root
     * (that path is for session files and breaks WoF if set to e.g. sessions/).
     */
    function resolvedGithubFilePath() {
        var custom = String(getPref('wallOfFameRepoPath', '') || '').trim();
        if (custom) {
            return custom.replace(/^\/+/, '');
        }
        return WALL_OF_FAME_FILE_PATH;
    }

    function hideTopClickersPanel() {
        var tcp = document.getElementById(TCP_PANEL_ID);
        if (tcp) {
            tcp.style.display = 'none';
        }
        var tcTab = document.getElementById('dc-fims-top-clickers-host');
        if (tcTab) {
            tcTab.classList.remove('active');
        }
    }

    var LS_KEY = 'donkeycode.sodWallOfFame.v1';
    var SESSION_KEY = 'dc_wof_unlocked';
    var EDIT_PASSWORD = 'DonkeyWall';
    var editPanelOpen = false;

    var rootMo = null;
    var onPopState = null;
    var onHashChange = null;
    var navInterval = null;
    var lastNavKey = '';

    function getPref(key, def) {
        if (typeof donkeycodeGetPref !== 'function') {
            return def;
        }
        var v = donkeycodeGetPref(key);
        if (v === undefined || v === null || v === '') {
            return def;
        }
        return v;
    }

    function proxyBaseUrl() {
        var u = String(getPref('wallOfFameProxyUrl', '') || '').trim().replace(/\/+$/, '');
        return u;
    }

    function proxyTeamKey() {
        return String(getPref('wallOfFameTeamKey', '') || '').trim();
    }

    function useGithubActions() {
        var v = getPref('wallOfFameUseGithubActions', false);
        return v === true || v === 'true';
    }

    /** Repo secret WOF_TEAM_KEY must match; workflow validates server-side. */
    function actionsModeConfigured() {
        return useGithubActions() && !!proxyTeamKey();
    }

    function proxyConfigured() {
        return !!(proxyBaseUrl() && proxyTeamKey());
    }

    function rawGithubWallOfFameUrl() {
        var owner = resolvedGithubOwner();
        var repo = resolvedGithubRepo();
        var branch = resolvedGithubBranch();
        var rel = resolvedGithubFilePath().replace(/^\/+/, '');
        var encodedPath = rel.split('/').map(encodeURIComponent).join('/');
        return (
            'https://raw.githubusercontent.com/' +
            encodeURIComponent(owner) +
            '/' +
            encodeURIComponent(repo) +
            '/' +
            encodeURIComponent(branch) +
            '/' +
            encodedPath
        );
    }

    /**
     * Public raw file GET. Returns null entries → caller may fall back to Contents API (private repo).
     */
    function rawGithubGet(cb) {
        if (typeof GM_xmlhttpRequest !== 'function') {
            cb(null);
            return;
        }
        GM_xmlhttpRequest({
            method: 'GET',
            url: rawGithubWallOfFameUrl(),
            onload: function(res) {
                var st = res.status || 0;
                if (st === 404) {
                    cb([]);
                    return;
                }
                if (st < 200 || st >= 300) {
                    cb(null);
                    return;
                }
                var text = res.responseText || '';
                var entries = parseEntriesFromJsonText(text);
                if (entries === null) {
                    cb(null);
                    return;
                }
                cb(entries);
            },
            onerror: function() {
                cb(null);
            }
        });
    }

    function githubRepositoryDispatch(doc, cb) {
        if (typeof GM_xmlhttpRequest !== 'function') {
            cb(false, 'GM_xmlhttpRequest unavailable');
            return;
        }
        var owner = resolvedGithubOwner();
        var repo = resolvedGithubRepo();
        var url =
            'https://api.github.com/repos/' +
            encodeURIComponent(owner) +
            '/' +
            encodeURIComponent(repo) +
            '/dispatches';
        var headers = githubApiHeaders();
        headers['Content-Type'] = 'application/json';
        var payload = {
            team_key: proxyTeamKey(),
            document: doc,
            path: resolvedGithubFilePath()
        };
        var body = {
            event_type: 'wall-of-fame-put',
            client_payload: payload
        };
        GM_xmlhttpRequest({
            method: 'POST',
            url: url,
            headers: headers,
            data: JSON.stringify(body),
            onload: function(res) {
                var st = res.status || 0;
                if (st === 204) {
                    cb(true, null);
                    return;
                }
                cb(
                    false,
                    'Dispatch HTTP ' + st + ' ' + (res.responseText || '').slice(0, 400)
                );
            },
            onerror: function() {
                cb(false, 'Network error');
            }
        });
    }

    /** Last blob SHA for GitHub Contents API (updates require SHA). */
    var githubFileSha = null;

    function githubConfigured() {
        return !!resolvedGithubPat();
    }

    function syncConfigured() {
        return proxyConfigured() || githubConfigured() || actionsModeConfigured();
    }

    /** repository_dispatch needs a PAT with repo scope (same as session sync). */
    function actionsPublishConfigured() {
        return actionsModeConfigured() && githubConfigured();
    }

    function proxyRequest(method, bodyObj, cb) {
        if (typeof GM_xmlhttpRequest !== 'function') {
            cb(0, '');
            return;
        }
        var base = proxyBaseUrl();
        var key = proxyTeamKey();
        var url = base + '/wall-of-fame';
        var headers = {
            Accept: 'application/json',
            'X-Wall-Of-Fame-Key': key
        };
        var hasBody = bodyObj !== undefined && bodyObj !== null;
        if (hasBody) {
            headers['Content-Type'] = 'application/json';
        }
        var pdata = undefined;
        if (hasBody) {
            pdata = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
        }
        GM_xmlhttpRequest({
            method: method,
            url: url,
            headers: headers,
            data: pdata,
            onload: function(res) {
                cb(res.status || 0, res.responseText || '');
            },
            onerror: function() {
                cb(0, '');
            }
        });
    }

    function proxyGetFile(cb) {
        proxyRequest('GET', null, function(status, text) {
            if (status < 200 || status >= 300) {
                cb(null);
                return;
            }
            try {
                var entries = parseEntriesFromJsonText(text);
                cb(entries);
            } catch (e) {
                cb(null);
            }
        });
    }

    function proxyPutDocument(doc, cb) {
        proxyRequest('PUT', doc, function(status, text) {
            if (status >= 200 && status < 300) {
                cb(true, null);
                return;
            }
            if (status === 401) {
                cb(false, 'Proxy rejected team key (check wallOfFameTeamKey).');
                return;
            }
            if (status === 409) {
                cb(false, 'conflict');
                return;
            }
            var err = 'HTTP ' + status;
            try {
                var j = JSON.parse(text);
                if (j.error) {
                    err = String(j.error);
                }
            } catch (e) {
                if (text) {
                    err = text.slice(0, 300);
                }
            }
            cb(false, err);
        });
    }

    function githubContentsApiUrl() {
        var owner = encodeURIComponent(resolvedGithubOwner());
        var repo = encodeURIComponent(resolvedGithubRepo());
        var path = resolvedGithubFilePath()
            .replace(/^\/+/, '')
            .split('/')
            .map(encodeURIComponent)
            .join('/');
        return 'https://api.github.com/repos/' + owner + '/' + repo + '/contents/' + path;
    }

    function githubApiHeaders() {
        return {
            Authorization: 'Bearer ' + resolvedGithubPat(),
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
        };
    }

    function utf8ToBase64(str) {
        return btoa(unescape(encodeURIComponent(str)));
    }

    function decodeGithubFileContent(b64) {
        if (!b64) {
            return '';
        }
        var clean = String(b64).replace(/\s/g, '');
        var bin = atob(clean);
        try {
            return decodeURIComponent(escape(bin));
        } catch (e) {
            return bin;
        }
    }

    function parseEntriesFromJsonText(text) {
        try {
            var data = JSON.parse(text);
            var arr = Array.isArray(data) ? data : (data.entries || []);
            return arr.map(normalizeEntry).filter(Boolean);
        } catch (e) {
            try {
                console.warn(
                    '[Wall of Fame] Invalid JSON in wall-of-fame.json — fix the file in the repo (commas, trailing commas).',
                    e && e.message ? e.message : e
                );
            } catch (ignore) {}
            return null;
        }
    }

    /**
     * Explains GitHub 4xx/0 when publish fails (token, permissions, or very old DonkeyCODE
     * without request-body forwarding).
     */
    function explainGithubPublishError(status, responseText) {
        var raw = String(responseText || '');
        var msg = '';
        try {
            var j = JSON.parse(raw);
            if (j.message) {
                msg = String(j.message);
            }
        } catch (e) {
            msg = raw.slice(0, 400);
        }
        var blob = (msg + ' ' + raw).toLowerCase();
        if (status === 401) {
            return 'GitHub returned 401 — check the PAT (repo scope) and that it is not expired.';
        }
        if (status === 403) {
            return 'GitHub returned 403 — token may lack Contents write on this repo or path (fine-grained rules).';
        }
        if (
            status === 400 ||
            status === 422 ||
            (status >= 400 && status < 500 && blob.indexOf('content') !== -1) ||
            blob.indexOf('problems parsing') !== -1 ||
            blob.indexOf('invalid request') !== -1
        ) {
            return (
                'GitHub rejected the publish request. Update DonkeyCODE to a build that forwards GM_xmlhttpRequest ' +
                '`data` / `body` into fetch(), set Content-Type: application/json, and use a PAT with Contents write. ' +
                '(HTTP ' + status + (msg ? ': ' + msg : '') + ')'
            );
        }
        if (status === 0 || !status) {
            return (
                'Request failed (HTTP 0). Enable DonkeyCODE optional site access (http(s)://*/*), check @connect, ' +
                'and inspect the extension service worker console for GM_XHR errors.'
            );
        }
        return 'HTTP ' + status + (msg ? ': ' + msg : '');
    }

    /**
     * DonkeyCODE: pass `data` (string or object; bridge may stringify objects) and set
     * Content-Type for GitHub REST JSON bodies. See SCRIPT_STANDARD_PLAN.md GM_xhr section.
     */
    function githubXhr(method, url, bodyObj, cb) {
        if (typeof GM_xmlhttpRequest !== 'function') {
            cb(0, '');
            return;
        }
        var headers = githubApiHeaders();
        var hasBody = bodyObj !== undefined && bodyObj !== null;
        if (hasBody) {
            headers['Content-Type'] = 'application/json';
        }
        var payload = undefined;
        if (hasBody) {
            payload = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
        }
        GM_xmlhttpRequest({
            method: method,
            url: url,
            headers: headers,
            data: payload,
            onload: function(res) {
                cb(res.status || 0, res.responseText || '');
            },
            onerror: function() {
                cb(0, '');
            }
        });
    }

    function githubGetFile(cb) {
        var branch = encodeURIComponent(resolvedGithubBranch());
        var url = githubContentsApiUrl() + '?ref=' + branch;
        githubXhr('GET', url, null, function(status, text) {
            if (status === 404) {
                githubFileSha = null;
                cb(null, null);
                return;
            }
            if (status < 200 || status >= 300) {
                cb(null, null);
                return;
            }
            try {
                var meta = JSON.parse(text);
                githubFileSha = meta.sha || null;
                var raw = decodeGithubFileContent(meta.content || '');
                var entries = parseEntriesFromJsonText(raw);
                cb(entries, githubFileSha);
            } catch (e) {
                cb(null, githubFileSha);
            }
        });
    }

    function githubPutFile(entries, sha, cb) {
        var branch = resolvedGithubBranch();
        var payload = {
            entries: entries,
            updatedAt: Date.now()
        };
        var bodyStr = JSON.stringify(payload, null, 2);
        var body = {
            message: 'Wall of Fame sync (DonkeyCODE)',
            content: utf8ToBase64(bodyStr),
            branch: branch
        };
        if (sha) {
            body.sha = sha;
        }
        var url = githubContentsApiUrl();
        githubXhr('PUT', url, body, function(status, text) {
            if (status === 200 || status === 201) {
                try {
                    var meta = JSON.parse(text);
                    if (meta.content && meta.content.sha) {
                        githubFileSha = meta.content.sha;
                    } else if (meta.commit && meta.commit.sha) {
                        githubFileSha = meta.commit.sha;
                    }
                } catch (e) {}
                cb(true, null);
                return;
            }
            if (status === 409) {
                cb(false, 'conflict');
                return;
            }
            cb(false, explainGithubPublishError(status, text));
        });
    }

    function isUnlocked() {
        try {
            return sessionStorage.getItem(SESSION_KEY) === '1';
        } catch (e) {
            return false;
        }
    }

    function setUnlocked(ok) {
        try {
            if (ok) {
                sessionStorage.setItem(SESSION_KEY, '1');
            } else {
                sessionStorage.removeItem(SESSION_KEY);
            }
        } catch (e) {
            /* ignore */
        }
    }

    function normalizeEntry(e) {
        if (!e || typeof e !== 'object') {
            return null;
        }
        var id = String(e.id || '').trim() || ('wof-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9));
        return {
            id: id,
            title: String(e.title || '').trim() || 'Accolade',
            holder: String(e.holder || '').trim() || '—',
            note: String(e.note || '').trim(),
            sortOrder: Number.isFinite(Number(e.sortOrder)) ? Number(e.sortOrder) : 0,
            updatedAt: Number.isFinite(Number(e.updatedAt)) ? Number(e.updatedAt) : Date.now()
        };
    }

    function loadLocal() {
        try {
            var raw = localStorage.getItem(LS_KEY);
            if (!raw) {
                return [];
            }
            var parsed = JSON.parse(raw);
            var arr = Array.isArray(parsed) ? parsed : (parsed.entries || []);
            if (!arr.length) {
                return [];
            }
            return arr.map(normalizeEntry).filter(Boolean);
        } catch (err) {
            return [];
        }
    }

    function saveLocal(entries) {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(entries));
        } catch (e) {
            /* ignore */
        }
    }

    function mergeEntries(a, b) {
        a = a || [];
        b = b || [];
        var map = {};
        var i;
        for (i = 0; i < a.length; i++) {
            var ea = normalizeEntry(a[i]);
            if (ea) {
                map[ea.id] = ea;
            }
        }
        for (i = 0; i < b.length; i++) {
            var eb = normalizeEntry(b[i]);
            if (!eb) {
                continue;
            }
            var ex = map[eb.id];
            if (!ex || eb.updatedAt >= (ex.updatedAt || 0)) {
                map[eb.id] = eb;
            }
        }
        var out = [];
        var k;
        for (k in map) {
            if (Object.prototype.hasOwnProperty.call(map, k)) {
                out.push(map[k]);
            }
        }
        out.sort(function(x, y) {
            return (x.sortOrder || 0) - (y.sortOrder || 0);
        });
        return out;
    }

    function fetchCloud(cb) {
        if (proxyConfigured()) {
            proxyGetFile(cb);
            return;
        }
        if (actionsModeConfigured()) {
            rawGithubGet(function(entries) {
                if (entries !== null) {
                    cb(entries);
                    return;
                }
                if (githubConfigured()) {
                    githubGetFile(function(e2) {
                        cb(e2);
                    });
                    return;
                }
                cb(null);
            });
            return;
        }
        if (!githubConfigured()) {
            cb(null);
            return;
        }
        githubGetFile(function(entries) {
            cb(entries);
        });
    }

    function postCloud(entries, cb) {
        var panel = document.getElementById(PANEL_ID);

        function doGithubPut() {
            githubGetFile(function(remote, sha) {
                var merged = mergeEntries(entries, remote || []);
                entriesState = merged;
                saveLocal(entriesState);
                if (panel) {
                    render(panel);
                }
                githubPutFile(merged, sha, function(ok, err) {
                    if (ok) {
                        cb(true, null);
                        return;
                    }
                    if (err === 'conflict') {
                        githubGetFile(function(remote2, sha2) {
                            var merged2 = mergeEntries(entriesState, remote2 || []);
                            entriesState = merged2;
                            saveLocal(entriesState);
                            if (panel) {
                                render(panel);
                            }
                            githubPutFile(merged2, sha2, function(ok2, err2) {
                                cb(ok2, err2 || null);
                            });
                        });
                        return;
                    }
                    cb(false, err || 'GitHub PUT failed');
                });
            });
        }

        if (proxyConfigured()) {
            proxyGetFile(function(remote) {
                var merged = mergeEntries(entries, remote || []);
                entriesState = merged;
                saveLocal(entriesState);
                if (panel) {
                    render(panel);
                }
                var doc = {
                    entries: merged,
                    updatedAt: Date.now()
                };
                proxyPutDocument(doc, function(ok, err) {
                    if (ok) {
                        cb(true, null);
                        return;
                    }
                    if (err === 'conflict') {
                        proxyGetFile(function(remote2) {
                            var merged2 = mergeEntries(entriesState, remote2 || []);
                            entriesState = merged2;
                            saveLocal(entriesState);
                            if (panel) {
                                render(panel);
                            }
                            proxyPutDocument(
                                { entries: merged2, updatedAt: Date.now() },
                                function(ok2, err2) {
                                    cb(ok2, err2 || null);
                                }
                            );
                        });
                        return;
                    }
                    cb(false, err || 'Proxy publish failed');
                });
            });
            return;
        }

        if (actionsModeConfigured()) {
            if (!actionsPublishConfigured()) {
                cb(
                    false,
                    'Actions mode: set donkeycode_github_pat (repo scope) to trigger workflow, and repo secret WOF_TEAM_KEY must match wallOfFameTeamKey.'
                );
                return;
            }
            rawGithubGet(function(remote) {
                if (remote === null && githubConfigured()) {
                    githubGetFile(function(r2) {
                        runActionsDispatch(r2 || []);
                    });
                    return;
                }
                runActionsDispatch(remote || []);
            });
            return;
        }

        function runActionsDispatch(remote) {
            var merged = mergeEntries(entries, remote || []);
            entriesState = merged;
            saveLocal(entriesState);
            if (panel) {
                render(panel);
            }
            var doc = {
                entries: merged,
                updatedAt: Date.now()
            };
            githubRepositoryDispatch(doc, function(ok, err) {
                if (ok) {
                    cb(true, null);
                    return;
                }
                cb(false, err || 'repository_dispatch failed');
            });
        }

        if (!githubConfigured()) {
            cb(
                false,
                'Set GitHub in DonkeyCODE settings (session sync), wallOfFameUseGithubActions + team key, or wallOfFameProxyUrl + team key.'
            );
            return;
        }
        doGithubPut();
    }

    function ensureStyles() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }
        var css = [
            '#' + PANEL_ID + '{display:none;padding:0;width:100%;box-sizing:border-box;min-height:min(75vh,900px);',
            'background:linear-gradient(160deg,#1a1025 0%,#2d1f4a 50%,#1e3a5f 100%);',
            'border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.35);overflow:hidden;max-height:85vh;}',
            '#' + PANEL_ID + ' .dc-wof-inner{padding:16px 18px;color:#f0e8ff;font-family:system-ui,-apple-system,sans-serif;',
            'width:100%;max-width:none;box-sizing:border-box;}',
            '#' + PANEL_ID + ' .dc-wof-h{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,.15);}',
            '#' + PANEL_ID + ' .dc-wof-head-actions{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;}',
            '#' + PANEL_ID + ' .dc-wof-edit-toggle{font-size:11px;padding:5px 11px;border-radius:8px;border:1px solid rgba(255,215,0,.45);',
            'background:rgba(255,215,0,.12);color:#ffe8a8;cursor:pointer;font-weight:600;}',
            '#' + PANEL_ID + ' .dc-wof-edit-toggle:hover{background:rgba(255,215,0,.22);}',
            '#' + PANEL_ID + ' .dc-wof-head-emoji{font-size:1.75rem;line-height:1;}',
            '#' + PANEL_ID + ' .dc-wof-title{font-weight:800;font-size:1.2rem;background:linear-gradient(90deg,#ffd700,#ff8c00,#da70d6);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;}',
            '#' + PANEL_ID + ' .dc-wof-sub{font-size:.75rem;opacity:.75;margin-top:4px;color:#c8b8e0;}',
            '#' + PANEL_ID + ' .dc-wof-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;max-height:calc(85vh - 200px);overflow:auto;padding:2px;}',
            '#' + PANEL_ID + ' .dc-wof-card{background:rgba(255,255,255,.08);border:1px solid rgba(255,215,0,.25);border-radius:10px;padding:12px;',
            'min-height:100px;display:flex;flex-direction:column;}',
            '#' + PANEL_ID + ' .dc-wof-card-t{font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;opacity:.85;color:#e8d4ff;margin-bottom:6px;}',
            '#' + PANEL_ID + ' .dc-wof-card-h{font-weight:700;font-size:1rem;color:#fff;line-height:1.3;}',
            '#' + PANEL_ID + ' .dc-wof-card-n{margin-top:8px;font-size:.95rem;color:#ffd700;font-weight:600;}',
            '#' + PANEL_ID + ' .dc-wof-card-note{margin-top:4px;font-size:.78rem;opacity:.75;font-style:italic;}',
            '#' + PANEL_ID + ' .dc-wof-edit{display:none;margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.12);}',
            '#' + PANEL_ID + ' .dc-wof-edit label{display:block;font-size:.72rem;opacity:.85;margin-bottom:4px;}',
            '#' + PANEL_ID + ' .dc-wof-edit input,.dc-wof-edit textarea{width:100%;box-sizing:border-box;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.25);color:#fff;margin-bottom:8px;font-size:13px;}',
            '#' + PANEL_ID + ' .dc-wof-edit textarea{min-height:52px;resize:vertical;}',
            '#' + PANEL_ID + ' .dc-wof-btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;}',
            '#' + PANEL_ID + ' .dc-wof-btns button{padding:8px 12px;border-radius:8px;border:none;cursor:pointer;font-size:12px;font-weight:600;}',
            '#' + PANEL_ID + ' .dc-wof-btn-gold{background:linear-gradient(135deg,#b8860b,#ffd700);color:#2a1a00;}',
            '#' + PANEL_ID + ' .dc-wof-btn-sec{background:rgba(255,255,255,.12);color:#eee;}',
            '#' + PANEL_ID + ' .dc-wof-list{margin:8px 0 0;padding-left:1.1em;font-size:.8rem;opacity:.9;}',
            '#' + PANEL_ID + ' .dc-wof-hint{font-size:.65rem;opacity:.6;margin-top:10px;line-height:1.4;}'
        ].join('');
        var st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = css;
        (document.head || document.documentElement).appendChild(st);
    }

    var entriesState = loadLocal();

    function renderCards(container) {
        var grid = container.querySelector('.dc-wof-grid');
        if (!grid) {
            return;
        }
        grid.innerHTML = '';
        var list = entriesState.slice().sort(function(a, b) {
            return (a.sortOrder || 0) - (b.sortOrder || 0);
        });
        if (list.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'dc-wof-card';
            empty.style.opacity = '0.85';
            empty.style.fontStyle = 'italic';
            empty.textContent =
                'No accolades yet. Use Fetch from GitHub after configuring sync, or unlock Edit to add entries.';
            grid.appendChild(empty);
            return;
        }
        var i;
        for (i = 0; i < list.length; i++) {
            var e = list[i];
            var card = document.createElement('div');
            card.className = 'dc-wof-card';
            card.dataset.entryId = e.id;
            var t = document.createElement('div');
            t.className = 'dc-wof-card-t';
            t.textContent = 'Accolade';
            var h = document.createElement('div');
            h.className = 'dc-wof-card-h';
            h.textContent = e.title;
            var n = document.createElement('div');
            n.className = 'dc-wof-card-n';
            n.textContent = e.holder;
            card.appendChild(t);
            card.appendChild(h);
            card.appendChild(n);
            if (e.note) {
                var note = document.createElement('div');
                note.className = 'dc-wof-card-note';
                note.textContent = e.note;
                card.appendChild(note);
            }
            grid.appendChild(card);
        }
    }

    function syncEditPanelVisibility(panel) {
        var wrap = panel.querySelector('.dc-wof-edit');
        var btn = panel.querySelector('.dc-wof-edit-toggle');
        if (wrap) {
            wrap.style.display = editPanelOpen ? 'block' : 'none';
        }
        if (btn) {
            btn.textContent = editPanelOpen ? 'Hide editor' : 'Edit';
            btn.setAttribute('aria-expanded', editPanelOpen ? 'true' : 'false');
        }
    }

    function renderEditSection(panel) {
        var wrap = panel.querySelector('.dc-wof-edit');
        if (!wrap) {
            return;
        }
        wrap.innerHTML = '';
        var unlocked = isUnlocked();

        if (!unlocked) {
            var p1 = document.createElement('p');
            p1.style.fontSize = '0.85rem';
            p1.style.opacity = '0.9';
            p1.textContent = 'Enter the editor password to add or remove accolades. Use Fetch / Publish to sync with GitHub when a PAT is set.';
            var lab = document.createElement('label');
            lab.textContent = 'Password';
            var inp = document.createElement('input');
            inp.type = 'password';
            inp.setAttribute('autocomplete', 'new-password');
            inp.setAttribute('data-lpignore', 'true');
            inp.setAttribute('data-form-type', 'other');
            inp.placeholder = 'Password';
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'dc-wof-btn-gold';
            btn.textContent = 'Unlock';
            btn.addEventListener('click', function(ev) {
                ev.preventDefault();
                if (inp.value === EDIT_PASSWORD) {
                    setUnlocked(true);
                    renderEditSection(panel);
                } else {
                    alert('Incorrect password.');
                }
            });
            wrap.appendChild(p1);
            wrap.appendChild(lab);
            wrap.appendChild(inp);
            wrap.appendChild(btn);
            return;
        }

        var lockBtn = document.createElement('button');
        lockBtn.type = 'button';
        lockBtn.className = 'dc-wof-btn-sec';
        lockBtn.textContent = 'Lock editor';
        lockBtn.addEventListener('click', function(ev) {
            ev.preventDefault();
            setUnlocked(false);
            editPanelOpen = false;
            renderEditSection(panel);
        });
        wrap.appendChild(lockBtn);

        var la = document.createElement('label');
        la.textContent = 'Accolade title';
        var ta = document.createElement('input');
        ta.type = 'text';
        ta.setAttribute('autocomplete', 'off');
        ta.setAttribute('autocorrect', 'off');
        ta.setAttribute('autocapitalize', 'off');
        ta.setAttribute('spellcheck', 'false');
        ta.setAttribute('data-lpignore', 'true');
        ta.setAttribute('data-form-type', 'other');
        ta.placeholder = 'e.g. Most holds (PHX)';
        var lb = document.createElement('label');
        lb.textContent = 'Holder name';
        var tb = document.createElement('input');
        tb.type = 'text';
        tb.setAttribute('autocomplete', 'off');
        tb.setAttribute('autocorrect', 'off');
        tb.setAttribute('autocapitalize', 'off');
        tb.setAttribute('spellcheck', 'false');
        tb.setAttribute('data-lpignore', 'true');
        tb.setAttribute('data-form-type', 'other');
        tb.placeholder = 'Name';
        var lc = document.createElement('label');
        lc.textContent = 'Note (optional)';
        var tc = document.createElement('input');
        tc.type = 'text';
        tc.setAttribute('autocomplete', 'off');
        tc.setAttribute('autocorrect', 'off');
        tc.setAttribute('autocapitalize', 'off');
        tc.setAttribute('spellcheck', 'false');
        tc.setAttribute('data-lpignore', 'true');
        tc.setAttribute('data-form-type', 'other');
        tc.placeholder = 'Station, context, etc.';

        var addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'dc-wof-btn-gold';
        addBtn.textContent = 'Add accolade';
        addBtn.addEventListener('click', function(ev) {
            ev.preventDefault();
            var title = ta.value.trim();
            var holder = tb.value.trim();
            if (!title || !holder) {
                alert('Title and holder are required.');
                return;
            }
            var ent = normalizeEntry({
                id: 'wof-' + Date.now(),
                title: title,
                holder: holder,
                note: tc.value.trim(),
                sortOrder: entriesState.length + 1,
                updatedAt: Date.now()
            });
            entriesState.push(ent);
            saveLocal(entriesState);
            ta.value = '';
            tb.value = '';
            tc.value = '';
            renderCards(panel);
            renderEntryList(panel);
        });

        wrap.appendChild(document.createElement('hr'));
        wrap.appendChild(la);
        wrap.appendChild(ta);
        wrap.appendChild(lb);
        wrap.appendChild(tb);
        wrap.appendChild(lc);
        wrap.appendChild(tc);
        wrap.appendChild(addBtn);

        var ul = document.createElement('ul');
        ul.className = 'dc-wof-list';
        wrap.appendChild(ul);
        renderEntryList(panel);

        var pub = document.createElement('button');
        pub.type = 'button';
        pub.className = 'dc-wof-btn-sec';
        pub.textContent = 'Publish to GitHub';
        pub.title = proxyConfigured()
            ? 'Publish via team proxy (GitHub App on server)'
            : actionsModeConfigured()
              ? 'Trigger Actions workflow (repo secret WOF_TEAM_KEY + PAT to dispatch)'
              : 'PUT ' + resolvedGithubFilePath() + ' in ' + resolvedGithubOwner() + '/' + resolvedGithubRepo();
        pub.addEventListener('click', function(ev) {
            ev.preventDefault();
            if (!syncConfigured()) {
                alert(
                    'Enable: DonkeyCODE GitHub PAT, or Actions mode + team key + repo secret WOF_TEAM_KEY, or proxy URL + key.'
                );
                return;
            }
            postCloud(entriesState, function(ok, err) {
                if (ok) {
                    alert('Published.');
                } else {
                    alert('Publish failed: ' + (err || 'unknown'));
                }
            });
        });
        wrap.appendChild(pub);

        var imp = document.createElement('button');
        imp.type = 'button';
        imp.className = 'dc-wof-btn-sec';
        imp.textContent = 'Fetch from GitHub';
        imp.title = proxyConfigured()
            ? 'Fetch via team proxy'
            : actionsModeConfigured()
              ? 'Fetch from raw.githubusercontent.com (public) or Contents API if PAT set'
              : 'GET ' + resolvedGithubFilePath() + ' and merge (DonkeyCODE GitHub session sync settings)';
        imp.addEventListener('click', function(ev) {
            ev.preventDefault();
            if (!syncConfigured()) {
                alert('Turn on sync: GitHub PAT, Actions + team key, or proxy + team key.');
                return;
            }
            fetchCloud(function(remote) {
                if (remote === null) {
                    alert(
                        'Could not load (check Actions + team key, PAT, @connect, or wallOfFameRepoPath). See browser / extension service worker logs.'
                    );
                    return;
                }
                entriesState = mergeEntries(entriesState, remote);
                saveLocal(entriesState);
                renderCards(panel);
                renderEntryList(panel);
                alert('Merged from repo: ' + remote.length + ' entr' + (remote.length === 1 ? 'y' : 'ies') + '.');
            });
        });
        wrap.appendChild(imp);

        var hint = document.createElement('div');
        hint.className = 'dc-wof-hint';
        hint.textContent = proxyConfigured()
            ? 'Sync via team proxy (GitHub App on server). Local copy in localStorage. Add proxy host to @connect if needed.'
            : actionsModeConfigured()
              ? 'Actions mode: repo secret WOF_TEAM_KEY must match wallOfFameTeamKey. Publish needs PAT (repository_dispatch). Fetch uses raw.githubusercontent.com if public.'
              : 'Direct API: same PAT/repo as DonkeyCODE session sync. File under sessions root or WALL of FAME/. Local: localStorage.';
        wrap.appendChild(hint);

        syncEditPanelVisibility(panel);
    }

    function renderEntryList(panel) {
        var ul = panel.querySelector('.dc-wof-list');
        if (!ul || !isUnlocked()) {
            return;
        }
        ul.innerHTML = '';
        var list = entriesState.slice().sort(function(a, b) {
            return (a.sortOrder || 0) - (b.sortOrder || 0);
        });
        var i;
        for (i = 0; i < list.length; i++) {
            (function(ent) {
                var li = document.createElement('li');
                li.style.marginBottom = '6px';
                li.textContent = ent.title + ' — ' + ent.holder + ' ';
                var del = document.createElement('button');
                del.type = 'button';
                del.textContent = 'Remove';
                del.style.fontSize = '11px';
                del.style.marginLeft = '6px';
                del.style.cursor = 'pointer';
                del.addEventListener('click', function(ev) {
                    ev.preventDefault();
                    if (confirm('Remove this entry?')) {
                        entriesState = entriesState.filter(function(x) {
                            return x.id !== ent.id;
                        });
                        saveLocal(entriesState);
                        renderCards(panel);
                        renderEntryList(panel);
                    }
                });
                li.appendChild(del);
                ul.appendChild(li);
            })(list[i]);
        }
    }

    function render(panel) {
        if (!panel) {
            return;
        }
        renderCards(panel);
        renderEditSection(panel);
    }

    function findTabMenu() {
        var menus = document.querySelectorAll('.ui.attached.tabular.menu');
        var i;
        for (i = 0; i < menus.length; i++) {
            var m = menus[i];
            var links = m.querySelectorAll('a.item');
            var j;
            for (j = 0; j < links.length; j++) {
                if ((links[j].textContent || '').indexOf('Advisories') !== -1) {
                    return { menu: m, advisoriesTab: links[j] };
                }
            }
        }
        return null;
    }

    function getSegments(menu) {
        var p = menu.parentElement;
        if (!p) {
            return [];
        }
        var out = [];
        var ch = p.children;
        var i;
        for (i = 0; i < ch.length; i++) {
            var el = ch[i];
            if (el.classList && el.classList.contains('ui') && el.classList.contains('bottom') && el.classList.contains('attached') && el.classList.contains('segment')) {
                out.push(el);
            }
        }
        return out;
    }

    function showFimsTable() {
        var tab = document.getElementById(TAB_ID);
        if (tab) {
            tab.classList.remove('active');
        }
        var table = document.getElementById(TABLE_ID);
        var panel = document.getElementById(PANEL_ID);
        hideTopClickersPanel();
        if (table) {
            table.style.display = '';
        }
        if (panel) {
            panel.style.display = 'none';
        }
    }

    var lastWofActivate = 0;

    var menuTabMo = null;
    var menuTabDebounce = null;
    function scheduleMenuTabRepair() {
        if (menuTabDebounce) {
            clearTimeout(menuTabDebounce);
        }
        menuTabDebounce = setTimeout(function() {
            menuTabDebounce = null;
            if (!document.getElementById(TABLE_ID)) {
                return;
            }
            if (!getPref('wallOfFameShowTab', true)) {
                return;
            }
            if (!document.getElementById(TAB_ID) || !document.getElementById(PANEL_ID)) {
                ensureUi();
            }
        }, 80);
    }

    function wireMenuTabObserver(menu) {
        if (!menu || menu.dataset.dcWofMenuMo) {
            return;
        }
        menu.dataset.dcWofMenuMo = '1';
        if (menuTabMo) {
            menuTabMo.disconnect();
            menuTabMo = null;
        }
        menuTabMo = new MutationObserver(function() {
            scheduleMenuTabRepair();
        });
        /* childList only: subtree caused a flood of callbacks (class/text updates inside items)
         * and could freeze the page when combined with ensureUi(). */
        menuTabMo.observe(menu, { childList: true });
    }

    function showWallOfFame() {
        var now = Date.now();
        if (now - lastWofActivate < 120) {
            return;
        }
        lastWofActivate = now;

        ensureTab();
        ensurePanel();

        var found = findTabMenu();
        var tab = document.getElementById(TAB_ID);
        var table = document.getElementById(TABLE_ID);
        var panel = document.getElementById(PANEL_ID);
        if (!found || !tab || !table || !panel) {
            return;
        }
        var menu = found.menu;
        var items = menu.querySelectorAll('a.item');
        var i;
        for (i = 0; i < items.length; i++) {
            items[i].classList.remove('active');
        }
        tab.classList.add('active');
        var segments = getSegments(menu);
        if (segments.length >= 2) {
            segments[0].classList.add('active');
            segments[1].classList.remove('active');
        } else if (segments.length === 1) {
            segments[0].classList.add('active');
        }
        hideTopClickersPanel();
        table.style.display = 'none';
        panel.style.display = 'block';
        render(panel);
    }

    /**
     * Document capture on **click**: preventDefault on mousedown does not cancel the click,
     * so the menu still handled the event and could remove our tabs or switch views.
     */
    var wofDocCaptureWired = false;
    function onWofDocCapture(e) {
        if (e.type !== 'click' || e.button !== 0) {
            return;
        }
        var t = e.target;
        if (!t || typeof t.closest !== 'function') {
            return;
        }
        if (!t.closest('#' + TAB_ID)) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        showWallOfFame();
    }

    function wireWofTabCapture(tabEl) {
        if (!tabEl) {
            return;
        }
        if (!wofDocCaptureWired) {
            wofDocCaptureWired = true;
            document.addEventListener('click', onWofDocCapture, true);
        }
    }

    function wireTabs(menu) {
        if (!menu || menu.dataset.dcWofTabWire) {
            return;
        }
        menu.dataset.dcWofTabWire = '1';
        var links = menu.querySelectorAll('a.item');
        var j;
        for (j = 0; j < links.length; j++) {
            var link = links[j];
            if (link.id === TAB_ID) {
                continue;
            }
            if (link.id === 'dc-fims-top-clickers-host') {
                continue;
            }
            var txt = (link.textContent || '').replace(/\s+/g, ' ');
            if (txt.indexOf('FIMS') !== -1 || txt.indexOf('Advisories') !== -1) {
                link.addEventListener('click', showFimsTable);
            }
        }
    }

    function ensurePanel() {
        var existing = document.getElementById(PANEL_ID);
        if (existing) {
            return existing;
        }
        ensureStyles();
        var table = document.getElementById(TABLE_ID);
        if (!table || !table.parentNode) {
            return null;
        }
        var panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.display = 'none';

        var inner = document.createElement('div');
        inner.className = 'dc-wof-inner';

        var head = document.createElement('div');
        head.className = 'dc-wof-h';
        var ht = document.createElement('div');
        var title = document.createElement('div');
        title.className = 'dc-wof-title';
        title.textContent = 'Wall of Fame';
        var sub = document.createElement('div');
        sub.className = 'dc-wof-sub';
        sub.textContent = 'SOD accolades — local + optional sync to ' + resolvedGithubFilePath();
        ht.appendChild(title);
        ht.appendChild(sub);
        var actions = document.createElement('div');
        actions.className = 'dc-wof-head-actions';
        var editToggle = document.createElement('button');
        editToggle.type = 'button';
        editToggle.className = 'dc-wof-edit-toggle';
        editToggle.textContent = 'Edit';
        editToggle.setAttribute('aria-expanded', 'false');
        editToggle.title = 'Show or hide password and editor';
        editToggle.addEventListener('click', function(ev) {
            ev.preventDefault();
            ev.stopPropagation();
            editPanelOpen = !editPanelOpen;
            syncEditPanelVisibility(panel);
        });
        var em = document.createElement('span');
        em.className = 'dc-wof-head-emoji';
        em.setAttribute('aria-hidden', 'true');
        em.textContent = '\u{1F3DB}\u{FE0F}';
        actions.appendChild(editToggle);
        actions.appendChild(em);
        head.appendChild(ht);
        head.appendChild(actions);
        inner.appendChild(head);

        var grid = document.createElement('div');
        grid.className = 'dc-wof-grid';
        inner.appendChild(grid);

        var edit = document.createElement('div');
        edit.className = 'dc-wof-edit';
        inner.appendChild(edit);

        panel.appendChild(inner);
        table.parentNode.insertBefore(panel, table);

        entriesState = loadLocal();
        render(panel);

        if (syncConfigured()) {
            fetchCloud(function(remote) {
                if (remote !== null) {
                    entriesState = mergeEntries(entriesState, remote);
                    saveLocal(entriesState);
                    render(panel);
                }
            });
        } else if (!entriesState.length) {
            /** Public repo: load from raw.githubusercontent.com without PAT / Actions / proxy. */
            rawGithubGet(function(remote) {
                if (remote !== null && remote.length) {
                    entriesState = mergeEntries(entriesState, remote);
                    saveLocal(entriesState);
                    render(panel);
                }
            });
        }

        return panel;
    }

    function ensureTab() {
        if (!getPref('wallOfFameShowTab', true)) {
            return null;
        }
        var existing = document.getElementById(TAB_ID);
        if (existing) {
            wireWofTabCapture(existing);
            var foundExisting = findTabMenu();
            if (foundExisting && foundExisting.menu) {
                wireMenuTabObserver(foundExisting.menu);
            }
            return existing;
        }
        var found = findTabMenu();
        if (!found) {
            return null;
        }
        wireTabs(found.menu);
        wireMenuTabObserver(found.menu);
        var a = document.createElement('a');
        a.id = TAB_ID;
        a.className = 'item';
        a.href = '#';
        a.innerHTML = '<div>\u{1F3DB}\u{FE0F} Wall of Fame</div>';
        var insertAfter = document.getElementById('dc-fims-top-clickers-host') || found.advisoriesTab;
        insertAfter.insertAdjacentElement('afterend', a);
        wireWofTabCapture(a);
        return a;
    }

    function ensureUi() {
        ensureTab();
        ensurePanel();
    }

    function bootScan() {
        var t = document.getElementById(TABLE_ID);
        if (t) {
            ensureUi();
        }
    }

    rootMo = new MutationObserver(function() {
        bootScan();
    });
    rootMo.observe(document.documentElement, { childList: true, subtree: true });
    bootScan();

    function navKey() {
        return (window.location.pathname || '') + (window.location.search || '') + (window.location.hash || '');
    }
    function onNavMaybe() {
        if (navKey() !== lastNavKey) {
            lastNavKey = navKey();
            bootScan();
        }
    }
    lastNavKey = navKey();
    onPopState = onNavMaybe;
    onHashChange = onNavMaybe;
    window.addEventListener('popstate', onPopState);
    window.addEventListener('hashchange', onHashChange);
    navInterval = window.setInterval(onNavMaybe, 2000);

    window.__myScriptCleanup = function() {
        if (navInterval) {
            clearInterval(navInterval);
            navInterval = null;
        }
        window.removeEventListener('popstate', onPopState);
        window.removeEventListener('hashchange', onHashChange);
        if (rootMo) {
            rootMo.disconnect();
            rootMo = null;
        }
        if (menuTabMo) {
            menuTabMo.disconnect();
            menuTabMo = null;
        }
        if (menuTabDebounce) {
            clearTimeout(menuTabDebounce);
            menuTabDebounce = null;
        }
        if (wofDocCaptureWired) {
            document.removeEventListener('click', onWofDocCapture, true);
            wofDocCaptureWired = false;
        }
        var tab = document.getElementById(TAB_ID);
        if (tab && tab.parentNode) {
            tab.parentNode.removeChild(tab);
        }
        var panel = document.getElementById(PANEL_ID);
        if (panel && panel.parentNode) {
            panel.parentNode.removeChild(panel);
        }
        var st = document.getElementById(STYLE_ID);
        if (st && st.parentNode) {
            st.parentNode.removeChild(st);
        }
        var menuInfo = findTabMenu();
        if (menuInfo && menuInfo.menu) {
            delete menuInfo.menu.dataset.dcWofTabWire;
            delete menuInfo.menu.dataset.dcWofMenuMo;
        }
        window.__myScriptCleanup = undefined;
    };
})();
