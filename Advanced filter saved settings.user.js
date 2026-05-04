// ==UserScript==
// @name         Advanced filter saved settings
// @namespace    Wolf 2.0
// @version      0.3.0
// @description  Save and recall named Advanced filter input presets.
// @match        https://opssuitemain.swacorp.com/widgets/worksheet*
// @match        https://opssuitemain.swacorp.com/schedule*
// @grant        GM_xmlhttpRequest
// @connect      api.github.com
// @connect      raw.githubusercontent.com
// @donkeycode-pref {"advancedFilterDataOwner":{"type":"string","group":"Advanced filter saves","label":"JSON repo owner","description":"If blank: donkeycode_github_owner -> MikeBane57.","default":"","placeholder":""},"advancedFilterDataRepo":{"type":"string","group":"Advanced filter saves","label":"JSON repo name","description":"If blank: donkeycode_github_repo -> DonkeyCODE.","default":"","placeholder":""},"advancedFilterDataBranch":{"type":"string","group":"Advanced filter saves","label":"JSON branch","description":"If blank: donkeycode_github_branch -> main.","default":"","placeholder":""},"advancedFilterRepoPath":{"type":"string","group":"Advanced filter saves","label":"JSON folder in repo","description":"Base folder for shared presets. Empty -> ADVANCED FILTERS. When \"Match DonkeyCODE session folder\" is on, each session folder gets a subfolder under this base.","default":"","placeholder":"ADVANCED FILTERS"},"advancedFilterUseDonkeycodeFolder":{"type":"boolean","group":"Advanced filter saves","label":"Match DonkeyCODE session folder","description":"When on (default): cloud saves load/store under the active DonkeyCODE folder (same logic as worksheet state). When off: use only the JSON folder above (legacy one flat ADVANCED FILTERS tree).","default":true}}
// @updateURL    https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Advanced%20filter%20saved%20settings.user.js
// @downloadURL  https://github.com/MikeBane57/Wolf2.0/raw/refs/heads/main/Advanced%20filter%20saved%20settings.user.js
// ==/UserScript==

(function () {
    'use strict';

    var SCRIPT_ID = 'dc-advanced-filter-saved-settings';
    var STYLE_ID = SCRIPT_ID + '-style';
    var BUTTON_CLASS = 'dc-afss-button';
    var PANEL_ID = SCRIPT_ID + '-panel';
    var STORAGE_KEY = 'dc_advanced_filter_saved_settings_v1';
    var TITLE_RE = /^\s*advanced\s+filters?\s*$/i;
    var CONTROL_SELECTOR = 'input, select, textarea';
    var SEMANTIC_DROPDOWN_SELECTOR = '.ui.dropdown[role="combobox"], [role="combobox"].ui.dropdown';
    var GITHUB_OWNER = 'MikeBane57';
    var GITHUB_REPO = 'DonkeyCODE';
    var GITHUB_BRANCH = 'main';
    var CLOUD_ROOT = 'ADVANCED FILTERS';

    var cloudPresets = [];
    var cloudLoaded = false;
    var cloudLoading = false;
    var lastSessionFolderPrefKey = '';
    var cloudFolderWatchTimer = 0;
    var lastCloudTargetSig = '';

    var observer = null;
    var rescanTimer = 0;
    var activeTitle = null;
    var activePanel = null;
    var outsideClickHandler = null;
    var keydownHandler = null;

    function safeJsonParse(raw, fallback) {
        try {
            return raw ? JSON.parse(raw) : fallback;
        } catch (e) {
            return fallback;
        }
    }

    function readStore() {
        var store = {};
        try {
            store = safeJsonParse(localStorage.getItem(STORAGE_KEY), {});
        } catch (e) {}
        if (!store || typeof store !== 'object' || Array.isArray(store)) {
            return {};
        }
        return store;
    }

    function writeStore(store) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(store || {}));
            return true;
        } catch (e) {
            return false;
        }
    }

    function pageKey() {
        return location.origin + location.pathname;
    }

    function readPagePresets() {
        var store = readStore();
        var key = pageKey();
        var list = store[key];
        return Array.isArray(list) ? list : [];
    }

    function writePagePresets(list) {
        var store = readStore();
        store[pageKey()] = Array.isArray(list) ? list : [];
        return writeStore(store);
    }


    function getPref(key, def) {
        if (typeof donkeycodeGetPref !== 'function') {
            return def;
        }
        var v;
        try {
            v = donkeycodeGetPref(key);
        } catch (e) {
            return def;
        }
        if (v === undefined || v === null || v === '') {
            return def;
        }
        return v;
    }

    function trimText(value) {
        return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    }

    function getPrefRaw(key) {
        if (typeof donkeycodeGetPref !== 'function' || !key) {
            return null;
        }
        try {
            return donkeycodeGetPref(key);
        } catch (e) {
            return null;
        }
    }

    /**
     * DonkeyCODE may expose a string, JSON, or a plain object with name/path/folder/…
     * (same pattern as WS state-reload).
     */
    function extractFolderStringFromDonkeycodeValue(maybe) {
        if (maybe == null) {
            return '';
        }
        if (typeof maybe === 'object' && !Array.isArray(maybe) && maybe !== null) {
            var pickO =
                maybe.name ||
                maybe.path ||
                maybe.folder ||
                maybe.folderName ||
                maybe.key ||
                maybe.id ||
                maybe.slug ||
                maybe.label ||
                maybe.sessionFolder ||
                maybe.session;
            if (pickO != null) {
                var t = trimText(String(pickO));
                if (t) {
                    return t;
                }
            }
        }
        var s = typeof maybe === 'string' ? maybe : JSON.stringify(maybe);
        s = trimText(s);
        if (!s) {
            return '';
        }
        if (s === '__default__' || s.toLowerCase() === 'default') {
            return s === '__default__' ? '__default__' : 'default';
        }
        if (s.charAt(0) === '{' || s.charAt(0) === '[') {
            var o = safeJsonParse(s, null);
            if (o && typeof o === 'object' && !Array.isArray(o)) {
                return extractFolderStringFromDonkeycodeValue(o);
            }
        }
        return s;
    }

    function globalDonkeycodeSessionFolder() {
        var g;
        try {
            g = typeof globalThis !== 'undefined' ? globalThis : window;
        } catch (e) {
            g = window;
        }
        if (!g) {
            return '';
        }
        if (typeof g.donkeycodeGetCurrentSessionFolder === 'function') {
            try {
                var v = g.donkeycodeGetCurrentSessionFolder();
                var s = extractFolderStringFromDonkeycodeValue(v);
                s = trimText(String(s == null ? '' : s));
                if (s) {
                    lastSessionFolderPrefKey = 'donkeycodeGetCurrentSessionFolder()';
                    return s;
                }
            } catch (e2) {}
        }
        if (g.donkeycodeCurrentSessionFolder != null && g.donkeycodeCurrentSessionFolder !== '') {
            var s2 = extractFolderStringFromDonkeycodeValue(g.donkeycodeCurrentSessionFolder);
            s2 = trimText(String(s2 == null ? '' : s2));
            if (s2) {
                lastSessionFolderPrefKey = 'window.donkeycodeCurrentSessionFolder';
                return s2;
            }
        }
        return '';
    }

    function donkeycodeCurrentSessionFolderRaw() {
        lastSessionFolderPrefKey = '';
        var fromGlobal = globalDonkeycodeSessionFolder();
        if (fromGlobal) {
            return fromGlobal;
        }
        var tryKeys = [
            'donkeycode_current_session_folder',
            'donkeycode_active_session_folder',
            'donkeycode_session_folder',
            'donkeycode_session_folder_key',
            'donkeycode_active_session_key',
            'donkeycode_session_key',
            'donkeycode_active_session',
            'donkeycode_current_session',
            'donkeycode_current_session_id'
        ];
        var i;
        for (i = 0; i < tryKeys.length; i++) {
            var k = tryKeys[i];
            var v = getPrefRaw(k);
            if (v === undefined || v === null || (typeof v === 'string' && v === '')) {
                continue;
            }
            var ex = extractFolderStringFromDonkeycodeValue(v);
            ex = trimText(String(ex == null ? '' : ex));
            if (ex) {
                lastSessionFolderPrefKey = k;
                return ex;
            }
        }
        return '';
    }

    function legacySessionFolderFromPrefs() {
        var keys = [
            'donkeycode_current_folder',
            'donkeycode_folder',
            'donkeycode_session_name',
            'donkeycode_active_session_name',
            'donkeycode_active_tab_folder',
            'donkeycode_session'
        ];
        var j;
        for (j = 0; j < keys.length; j++) {
            var v = getPrefRaw(keys[j]);
            if (v === undefined || v === null) {
                continue;
            }
            var t = extractFolderStringFromDonkeycodeValue(v);
            t = trimText(String(t == null ? '' : t));
            if (!t) {
                continue;
            }
            t = t.replace(/^\/+|\/+$/g, '');
            if (!t) {
                continue;
            }
            if (/[\\/]/.test(t) && (t.indexOf('github') >= 0 || t.indexOf('.com') >= 0 || t.split('/').length > 2)) {
                var seg = t.split(/[\\/]+/).filter(Boolean);
                t = seg[seg.length - 1] || t;
            }
            return t || 'Default';
        }
        return '';
    }

    function normalizeSessionFolderKey(s) {
        var t = trimText(String(s == null ? '' : s));
        if (!t) {
            return '__default__';
        }
        if (t === '__default__' || t === 'Default' || t.toLowerCase() === 'default') {
            return '__default__';
        }
        return t;
    }

    function sessionFolderKeyCanonical() {
        var r = trimText(donkeycodeCurrentSessionFolderRaw());
        if (r) {
            if (r === '__default__' || r.toLowerCase() === 'default') {
                return '__default__';
            }
            return r;
        }
        var leg = trimText(legacySessionFolderFromPrefs());
        if (leg) {
            lastSessionFolderPrefKey = 'legacy';
        }
        if (!leg || leg === 'Default') {
            if (!leg) {
                lastSessionFolderPrefKey = '';
            }
            return '__default__';
        }
        return leg;
    }

    function sessionFolderDisplayLabel(keyOrCanonical) {
        var k = trimText(String(keyOrCanonical == null ? '' : keyOrCanonical));
        if (!k) {
            return 'Default';
        }
        if (k === '__default__' || k === 'Default' || k.toLowerCase() === 'default') {
            return 'Default';
        }
        return k;
    }

    /** Safe single path segment for GitHub repo path (per DonkeyCODE folder). */
    function sessionFolderSegmentForRepo(canonicalKey) {
        var k = normalizeSessionFolderKey(canonicalKey);
        if (k === '__default__') {
            return '__default__';
        }
        var seg = String(k)
            .replace(/\\/g, '/')
            .split('/')
            .filter(Boolean)
            .join('-')
            .replace(/[^a-zA-Z0-9._-]+/g, '-')
            .replace(/^-+|-+$/g, '');
        return seg || 'folder';
    }

    function advancedFilterMatchDonkeycodeFolder() {
        var v = getPref('advancedFilterUseDonkeycodeFolder', true);
        if (v === false || v === 'false' || v === 0 || v === '0') {
            return false;
        }
        return true;
    }

    function resolvedGithubPat() {
        return trimText(getPref('donkeycode_github_pat', ''));
    }

    function resolvedCloudOwner() {
        return trimText(getPref('advancedFilterDataOwner', '')) || trimText(getPref('donkeycode_github_owner', '')) || GITHUB_OWNER;
    }

    function resolvedCloudRepo() {
        return trimText(getPref('advancedFilterDataRepo', '')) || trimText(getPref('donkeycode_github_repo', '')) || GITHUB_REPO;
    }

    function resolvedCloudBranch() {
        return trimText(getPref('advancedFilterDataBranch', '')) || trimText(getPref('donkeycode_github_branch', '')) || GITHUB_BRANCH;
    }

    function resolvedCloudRootBase() {
        var root = trimText(getPref('advancedFilterRepoPath', '')) || CLOUD_ROOT;
        return root.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\.\./g, '') || CLOUD_ROOT;
    }

    /**
     * Full repo-relative directory for this script's index + presets/.
     * When matching DonkeyCODE folder: …/ADVANCED FILTERS/<folder-segment>/.
     */
    function resolvedCloudRootDir() {
        var base = resolvedCloudRootBase();
        if (!advancedFilterMatchDonkeycodeFolder()) {
            return base;
        }
        var fk = sessionFolderKeyCanonical();
        return base + '/' + sessionFolderSegmentForRepo(fk);
    }

    function cloudStorageTargetSignature() {
        return resolvedCloudOwner() + '/' + resolvedCloudRepo() + '@' + resolvedCloudBranch() + ':' + resolvedCloudRootDir();
    }

    function indexJsonPath() {
        return resolvedCloudRootDir() + '/index.json';
    }

    function presetJsonPath(id) {
        return resolvedCloudRootDir() + '/presets/' + encodeURIComponent(String(id || 'preset')).replace(/%/g, '') + '.json';
    }

    function encodedRepoPath(path) {
        return String(path || '').replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
    }

    function githubContentsApiUrlForPath(relPath) {
        return 'https://api.github.com/repos/' + encodeURIComponent(resolvedCloudOwner()) + '/' + encodeURIComponent(resolvedCloudRepo()) + '/contents/' + encodedRepoPath(relPath);
    }

    function githubApiHeaders() {
        return {
            Authorization: 'Bearer ' + resolvedGithubPat(),
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
        };
    }

    function utf8ToBase64(str) {
        return btoa(unescape(encodeURIComponent(String(str == null ? '' : str))));
    }

    function decodeGithubFileContent(b64) {
        if (!b64) {
            return '';
        }
        var bin = atob(String(b64).replace(/\s/g, ''));
        try {
            return decodeURIComponent(escape(bin));
        } catch (e) {
            return bin;
        }
    }

    function gmXhr(method, url, headers, bodyObj, cb) {
        if (typeof GM_xmlhttpRequest !== 'function') {
            cb(0, 'GM_xmlhttpRequest unavailable.');
            return;
        }
        GM_xmlhttpRequest({
            method: method,
            url: url,
            headers: headers || {},
            data: bodyObj == null ? undefined : JSON.stringify(bodyObj),
            onload: function (res) {
                cb(res.status || 0, res.responseText || '');
            },
            onerror: function () {
                cb(0, 'Network error.');
            }
        });
    }

    function githubApiErrorSummary(status, body) {
        var o = safeJsonParse(String(body || ''), null);
        if (o && o.message) {
            return o.message;
        }
        return body ? String(body).slice(0, 200) : 'HTTP ' + status;
    }

    function getJsonAtCloudPath(relPath, cb) {
        if (!resolvedGithubPat()) {
            cb(null, 'Set donkeycode_github_pat to load shared filters.');
            return;
        }
        var url = githubContentsApiUrlForPath(relPath) + '?ref=' + encodeURIComponent(resolvedCloudBranch());
        gmXhr('GET', url, githubApiHeaders(), null, function (status, text) {
            if (status === 404) {
                cb(null, null);
                return;
            }
            if (status < 200 || status >= 300) {
                cb(null, 'GET ' + relPath + ' failed: HTTP ' + status + ' - ' + githubApiErrorSummary(status, text));
                return;
            }
            var meta = safeJsonParse(text, null);
            if (!meta) {
                cb(null, 'Could not parse GitHub metadata for ' + relPath + '.');
                return;
            }
            cb(safeJsonParse(decodeGithubFileContent(meta.content || ''), null), null, meta.sha || null);
        });
    }

    function getCloudFileSha(relPath, cb) {
        if (!resolvedGithubPat()) {
            cb({ sha: null }, null);
            return;
        }
        var url = githubContentsApiUrlForPath(relPath) + '?ref=' + encodeURIComponent(resolvedCloudBranch());
        gmXhr('GET', url, githubApiHeaders(), null, function (status, text) {
            if (status === 404) {
                cb({ sha: null }, null);
                return;
            }
            if (status < 200 || status >= 300) {
                cb(null, 'GET SHA failed: HTTP ' + status + ' - ' + githubApiErrorSummary(status, text));
                return;
            }
            var meta = safeJsonParse(text, null);
            cb({ sha: meta && meta.sha ? String(meta.sha) : null }, null);
        });
    }

    function putJsonAtCloudPath(relPath, jsonObj, message, cb) {
        if (!resolvedGithubPat()) {
            cb(false, 'Set donkeycode_github_pat with Contents read/write for ' + resolvedCloudOwner() + '/' + resolvedCloudRepo() + '.');
            return;
        }
        var attempts = 0;
        function putWithFreshSha() {
            getCloudFileSha(relPath, function (meta, err) {
                if (err) {
                    cb(false, err);
                    return;
                }
                var body = {
                    message: (message || 'Advanced filters: update shared preset') + (attempts ? ' (retry ' + attempts + ')' : ''),
                    content: utf8ToBase64(JSON.stringify(jsonObj, null, 2) + '\n'),
                    branch: resolvedCloudBranch()
                };
                if (meta && meta.sha) {
                    body.sha = meta.sha;
                }
                var headers = githubApiHeaders();
                headers['Content-Type'] = 'application/json';
                gmXhr('PUT', githubContentsApiUrlForPath(relPath), headers, body, function (status, text) {
                    if (status === 200 || status === 201) {
                        cb(true, null);
                        return;
                    }
                    if (status === 409 && attempts < 4) {
                        attempts += 1;
                        setTimeout(putWithFreshSha, 120);
                        return;
                    }
                    cb(false, 'PUT ' + relPath + ' failed: HTTP ' + status + ' - ' + githubApiErrorSummary(status, text));
                });
            });
        }
        putWithFreshSha();
    }

    function stableHash(value) {
        var s = String(value == null ? '' : value);
        var h = 0;
        for (var i = 0; i < s.length; i++) {
            h = ((h << 5) - h + s.charCodeAt(i)) | 0;
        }
        return Math.abs(h).toString(36);
    }

    function presetIdFromName(name) {
        var base = trimText(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'preset';
        var folderSalt = '';
        if (advancedFilterMatchDonkeycodeFolder()) {
            folderSalt = '|' + normalizeSessionFolderKey(sessionFolderKeyCanonical());
        }
        return base.slice(0, 48) + '-' + stableHash(pageKey() + folderSalt + '|' + trimText(name).toLowerCase());
    }

    function normalizeCloudPreset(raw) {
        if (!raw || typeof raw !== 'object' || !raw.snapshot) {
            return null;
        }
        var fk =
            raw.folderKey != null && raw.folderKey !== ''
                ? normalizeSessionFolderKey(raw.folderKey)
                : null;
        return {
            id: trimText(raw.id) || presetIdFromName(raw.name || 'preset'),
            name: trimText(raw.name) || '(unnamed)',
            pageKey: trimText(raw.pageKey || raw.scopeKey || ''),
            snapshot: raw.snapshot,
            updatedAt: raw.updatedAt || Date.now(),
            shared: true,
            createdBy: trimText(raw.createdBy || raw.creator || raw.author || ''),
            folderKey: fk
        };
    }

    function loadCloudPresets(panel, cb) {
        if (cloudLoading) {
            return;
        }
        cloudLoading = true;
        setStatus(panel, 'Loading shared filters...');
        getJsonAtCloudPath(indexJsonPath(), function (indexDoc, err) {
            if (err) {
                cloudLoading = false;
                setStatus(panel, err);
                if (cb) {
                    cb(false);
                }
                return;
            }
            var ids = indexDoc && Array.isArray(indexDoc.presetIds) ? indexDoc.presetIds.slice() : [];
            var out = [];
            function next(i) {
                if (i >= ids.length) {
                    cloudPresets = sortPresets(out);
                    cloudLoaded = true;
                    cloudLoading = false;
                    refreshPanelOptions(panel);
                    setStatus(panel, 'Loaded ' + cloudPresets.length + ' shared filter(s).');
                    if (cb) {
                        cb(true);
                    }
                    return;
                }
                getJsonAtCloudPath(presetJsonPath(ids[i]), function (doc) {
                    var norm = normalizeCloudPreset(doc);
                    if (norm && (!norm.pageKey || norm.pageKey === pageKey())) {
                        out.push(norm);
                    }
                    next(i + 1);
                });
            }
            next(0);
        });
    }

    function cloudPresetById(id) {
        for (var i = 0; i < cloudPresets.length; i++) {
            if (String(cloudPresets[i].id) === String(id)) {
                return cloudPresets[i];
            }
        }
        return null;
    }

    function saveCloudPreset(localPreset, cb) {
        var existing = null;
        for (var i = 0; i < cloudPresets.length; i++) {
            if (String(cloudPresets[i].name).toLowerCase() === String(localPreset.name).toLowerCase() && cloudPresets[i].pageKey === pageKey()) {
                existing = cloudPresets[i];
                break;
            }
        }
        var id = existing ? existing.id : presetIdFromName(localPreset.name);
        var doc = {
            version: 1,
            id: id,
            name: localPreset.name,
            pageKey: pageKey(),
            scope: { origin: location.origin, pathname: location.pathname },
            updatedAt: Date.now(),
            snapshot: localPreset.snapshot,
            createdBy: sessionFolderDisplayLabel(sessionFolderKeyCanonical()),
            folderKey: sessionFolderKeyCanonical()
        };
        getJsonAtCloudPath(indexJsonPath(), function (indexDoc) {
            var ids = indexDoc && Array.isArray(indexDoc.presetIds) ? indexDoc.presetIds.slice() : [];
            if (ids.indexOf(id) < 0) {
                ids.push(id);
            }
            var newIndex = { version: 1, format: 'advanced-filter-presets-shard', presetIds: ids, updatedAt: Date.now() };
            putJsonAtCloudPath(presetJsonPath(id), doc, 'Advanced filters: save shared preset ' + localPreset.name, function (ok, err) {
                if (!ok) {
                    cb(false, err);
                    return;
                }
                putJsonAtCloudPath(indexJsonPath(), newIndex, 'Advanced filters: update preset index', function (ok2, err2) {
                    if (ok2) {
                        var norm = normalizeCloudPreset(doc);
                        var found = false;
                        for (var j = 0; j < cloudPresets.length; j++) {
                            if (cloudPresets[j].id === norm.id) {
                                cloudPresets[j] = norm;
                                found = true;
                                break;
                            }
                        }
                        if (!found) {
                            cloudPresets.push(norm);
                        }
                        sortPresets(cloudPresets);
                    }
                    cb(ok2, err2);
                });
            });
        });
    }

    function cssEscape(value) {
        if (window.CSS && typeof window.CSS.escape === 'function') {
            return window.CSS.escape(String(value));
        }
        return String(value).replace(/["\\]/g, '\\$&');
    }

    function htmlEscape(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function textOf(el) {
        return String((el && el.textContent) || '').replace(/\s+/g, ' ').trim();
    }

    function visible(el) {
        if (!el || !el.isConnected) {
            return false;
        }
        var rects = el.getClientRects();
        if (!rects || !rects.length) {
            return false;
        }
        var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
        return !style || (style.visibility !== 'hidden' && style.display !== 'none');
    }

    function isTitleCandidate(el) {
        if (!el || !visible(el) || el.querySelector('.' + BUTTON_CLASS)) {
            return false;
        }
        if (!TITLE_RE.test(textOf(el))) {
            return false;
        }
        var tag = (el.tagName || '').toLowerCase();
        if (/^h[1-6]$/.test(tag) || tag === 'legend' || tag === 'summary' || tag === 'label') {
            return true;
        }
        return (el.children || []).length <= 2;
    }

    function findAdvancedFilterTitle() {
        var candidates = document.querySelectorAll('h1,h2,h3,h4,h5,h6,legend,summary,label,div,span,p');
        var best = null;
        var bestScore = -1;
        for (var i = 0; i < candidates.length; i++) {
            var el = candidates[i];
            if (!isTitleCandidate(el)) {
                continue;
            }
            var tag = (el.tagName || '').toLowerCase();
            var score = /^h[1-6]$/.test(tag) ? 30 : tag === 'legend' ? 25 : tag === 'summary' ? 20 : 10;
            if (score > bestScore) {
                best = el;
                bestScore = score;
            }
        }
        return best;
    }

    function controlsIn(root, includeHidden) {
        if (!root || !root.querySelectorAll) {
            return [];
        }
        var out = [];
        var dropdowns = root.querySelectorAll(SEMANTIC_DROPDOWN_SELECTOR);
        var i;
        for (i = 0; i < dropdowns.length; i++) {
            if (shouldTrackSemanticDropdown(dropdowns[i], includeHidden)) {
                out.push(dropdowns[i]);
            }
        }
        var raw = root.querySelectorAll(CONTROL_SELECTOR);
        for (i = 0; i < raw.length; i++) {
            if (shouldTrackControl(raw[i], includeHidden)) {
                out.push(raw[i]);
            }
        }
        return out;
    }

    function findFilterArea(title) {
        if (!title) {
            return null;
        }
        var siblingRoot = title.parentElement;
        if (siblingRoot) {
            var siblings = siblingRoot.children || [];
            var start = -1;
            for (var i = 0; i < siblings.length; i++) {
                if (siblings[i] === title || (siblings[i].contains && siblings[i].contains(title))) {
                    start = i;
                    break;
                }
            }
            for (var j = start + 1; j >= 1 && j < siblings.length && j <= start + 3; j++) {
                if (controlsIn(siblings[j], true).length) {
                    return siblings[j];
                }
            }
        }
        var el = title;
        var depth = 0;
        while (el && el !== document.body && depth < 8) {
            var controls = controlsIn(el, true);
            if (controls.length) {
                return el;
            }
            el = el.parentElement;
            depth++;
        }
        return null;
    }

    function shouldTrackControl(control, includeHidden) {
        if (!control || control.disabled || control.closest('#' + PANEL_ID)) {
            return false;
        }
        if (semanticDropdownRoot(control)) {
            return false;
        }
        if (!includeHidden && !visible(control)) {
            return false;
        }
        var tag = (control.tagName || '').toLowerCase();
        if (tag === 'input') {
            var type = String(control.type || 'text').toLowerCase();
            return ['button', 'submit', 'reset', 'image', 'file', 'hidden', 'password'].indexOf(type) === -1;
        }
        return tag === 'select' || tag === 'textarea';
    }

    function semanticDropdownRoot(el) {
        return el && el.closest ? el.closest(SEMANTIC_DROPDOWN_SELECTOR) : null;
    }

    function shouldTrackSemanticDropdown(dropdown, includeHidden) {
        if (!dropdown || dropdown.closest('#' + PANEL_ID) || (!includeHidden && !visible(dropdown))) {
            return false;
        }
        return !!(
            dropdown.getAttribute('name') ||
            dropdown.getAttribute('data-testid') ||
            dropdown.querySelector('.menu [role="option"], .menu .item') ||
            dropdown.querySelector(':scope > .ui.label, :scope > a.ui.label')
        );
    }

    function isSemanticDropdown(control) {
        return !!(
            control &&
            control.matches &&
            control.matches(SEMANTIC_DROPDOWN_SELECTOR)
        );
    }

    function findControlLabel(control) {
        if (!control) {
            return '';
        }
        if (control.id) {
            var explicit = document.querySelector('label[for="' + cssEscape(control.id) + '"]');
            if (explicit) {
                return textOf(explicit);
            }
        }
        var wrapped = control.closest && control.closest('label');
        if (wrapped) {
            return textOf(wrapped);
        }
        var field = control.closest && control.closest('.field,[class*="field"],[data-testid]');
        if (field) {
            var label = field.querySelector('label');
            if (label) {
                return textOf(label);
            }
        }
        return '';
    }

    function controlIdentity(control, index) {
        if (isSemanticDropdown(control)) {
            return semanticDropdownIdentity(control, index);
        }
        var type = (control.type || '').toLowerCase();
        var options = [];
        if ((control.tagName || '').toLowerCase() === 'select') {
            for (var i = 0; i < control.options.length; i++) {
                options.push(control.options[i].value + ':' + textOf(control.options[i]));
            }
        }
        return {
            index: index,
            tag: (control.tagName || '').toLowerCase(),
            type: type,
            id: control.id || '',
            name: control.name || '',
            testId: control.getAttribute('data-testid') || '',
            aria: control.getAttribute('aria-label') || '',
            placeholder: control.getAttribute('placeholder') || '',
            label: findControlLabel(control),
            options: options.join('|')
        };
    }

    function semanticDropdownIdentity(dropdown, index) {
        return {
            index: index,
            tag: (dropdown.tagName || '').toLowerCase(),
            type: 'semantic-dropdown',
            id: dropdown.id || '',
            name: dropdown.getAttribute('name') || '',
            testId: dropdown.getAttribute('data-testid') || '',
            aria: dropdown.getAttribute('aria-label') || '',
            placeholder: semanticDropdownPlaceholder(dropdown),
            label: findControlLabel(dropdown),
            options: semanticDropdownOptions(dropdown).join('|')
        };
    }

    function readControlValue(control) {
        if (isSemanticDropdown(control)) {
            return readSemanticDropdownValue(control);
        }
        var tag = (control.tagName || '').toLowerCase();
        var type = String(control.type || '').toLowerCase();
        if (tag === 'select' && control.multiple) {
            var values = [];
            for (var i = 0; i < control.options.length; i++) {
                if (control.options[i].selected) {
                    values.push(control.options[i].value);
                }
            }
            return values;
        }
        if (type === 'checkbox' || type === 'radio') {
            return !!control.checked;
        }
        return control.value;
    }

    function semanticDropdownPlaceholder(dropdown) {
        var text =
            dropdown.querySelector('.divider.default.text') ||
            dropdown.querySelector('.divider.text');
        return textOf(text);
    }

    function semanticDropdownOptions(dropdown) {
        var list = dropdown.querySelectorAll('.menu [role="option"], .menu .item');
        var out = [];
        for (var i = 0; i < list.length; i++) {
            var txt = textOf(list[i].querySelector('.text') || list[i]);
            if (txt) {
                out.push(txt);
            }
        }
        return out;
    }

    function directSemanticLabels(dropdown) {
        var labels = [];
        var children = dropdown ? dropdown.children || [] : [];
        for (var i = 0; i < children.length; i++) {
            var child = children[i];
            if (
                child &&
                child.matches &&
                child.matches('.ui.label, a.ui.label, [class~="label"]')
            ) {
                labels.push(child);
            }
        }
        return labels;
    }

    function readSemanticDropdownValue(dropdown) {
        var labels = directSemanticLabels(dropdown);
        var values = [];
        for (var i = 0; i < labels.length; i++) {
            var label = labels[i];
            var val = label.getAttribute('value') || label.getAttribute('data-value') || textOf(label);
            val = String(val || '').replace(/\s+/g, ' ').trim();
            if (val) {
                values.push(val);
            }
        }
        if (dropdown.classList && dropdown.classList.contains('multiple')) {
            return values;
        }
        if (values.length) {
            return values[0];
        }
        return readSingleSemanticDropdownText(dropdown);
    }

    function readSingleSemanticDropdownText(dropdown) {
        var children = dropdown ? dropdown.children || [] : [];
        for (var i = 0; i < children.length; i++) {
            var child = children[i];
            if (
                child &&
                child.matches &&
                child.matches('.text') &&
                !(child.classList && (child.classList.contains('default') || child.classList.contains('divider')))
            ) {
                return textOf(child);
            }
        }
        return '';
    }

    function snapshotArea(area) {
        var controls = controlsIn(area, true);
        var items = [];
        for (var i = 0; i < controls.length; i++) {
            items.push({
                identity: controlIdentity(controls[i], i),
                value: readControlValue(controls[i])
            });
        }
        return {
            createdAt: new Date().toISOString(),
            items: items
        };
    }

    function identityScore(want, got) {
        if (!want || !got || want.tag !== got.tag) {
            return -1;
        }
        var score = 0;
        if (want.type && want.type === got.type) {
            score += 2;
        }
        if (want.id && want.id === got.id) {
            score += 12;
        }
        if (want.name && want.name === got.name) {
            score += 10;
        }
        if (want.testId && want.testId === got.testId) {
            score += 10;
        }
        if (want.aria && want.aria === got.aria) {
            score += 6;
        }
        if (want.placeholder && want.placeholder === got.placeholder) {
            score += 5;
        }
        if (want.label && want.label === got.label) {
            score += 5;
        }
        if (want.options && want.options === got.options) {
            score += 4;
        }
        if (want.index === got.index) {
            score += 1;
        }
        return score;
    }

    function setNativeValue(control, prop, value) {
        var proto = control instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : control instanceof HTMLSelectElement
                ? HTMLSelectElement.prototype
                : HTMLInputElement.prototype;
        var desc = Object.getOwnPropertyDescriptor(proto, prop);
        if (desc && desc.set) {
            desc.set.call(control, value);
        } else {
            control[prop] = value;
        }
    }

    function dispatchControlEvents(control) {
        try {
            control.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
        } catch (e) {}
        try {
            control.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        } catch (e2) {}
    }

    function applyControlValue(control, value) {
        if (isSemanticDropdown(control)) {
            applySemanticDropdownValue(control, value);
            return;
        }
        var tag = (control.tagName || '').toLowerCase();
        var type = String(control.type || '').toLowerCase();
        if (tag === 'select' && control.multiple && Array.isArray(value)) {
            for (var i = 0; i < control.options.length; i++) {
                control.options[i].selected = value.indexOf(control.options[i].value) >= 0;
            }
            dispatchControlEvents(control);
            return;
        }
        if (type === 'checkbox' || type === 'radio') {
            setNativeValue(control, 'checked', !!value);
            dispatchControlEvents(control);
            return;
        }
        setNativeValue(control, 'value', value == null ? '' : String(value));
        dispatchControlEvents(control);
    }

    function clickLikeUser(el) {
        if (!el) {
            return;
        }
        var opts = { bubbles: true, cancelable: true, view: window };
        try {
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
        } catch (e) {
            try {
                el.click();
            } catch (e2) {}
        }
    }

    function clearSemanticDropdown(dropdown) {
        var labels = directSemanticLabels(dropdown);
        for (var i = labels.length - 1; i >= 0; i--) {
            var del = labels[i].querySelector('.delete.icon, i.delete');
            clickLikeUser(del || labels[i]);
        }
    }

    function findSemanticDropdownOption(dropdown, value) {
        var want = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (!want) {
            return null;
        }
        var options = dropdown.querySelectorAll('.menu [role="option"], .menu .item');
        for (var i = 0; i < options.length; i++) {
            var txt = textOf(options[i].querySelector('.text') || options[i]).toLowerCase();
            if (txt === want) {
                return options[i];
            }
        }
        return null;
    }

    function setSemanticSearchValue(dropdown, value) {
        var input = dropdown.querySelector('input.search, input[aria-autocomplete="list"], input[type="text"]');
        if (!input) {
            return;
        }
        setNativeValue(input, 'value', String(value || ''));
        dispatchControlEvents(input);
    }

    function applySemanticDropdownValue(dropdown, value) {
        var values = Array.isArray(value) ? value : value ? [value] : [];
        clearSemanticDropdown(dropdown);
        clickLikeUser(dropdown);
        for (var i = 0; i < values.length; i++) {
            setSemanticSearchValue(dropdown, values[i]);
            var option = findSemanticDropdownOption(dropdown, values[i]);
            if (option) {
                clickLikeUser(option);
            }
        }
        setSemanticSearchValue(dropdown, '');
        dispatchControlEvents(dropdown);
    }

    function clearControlValue(control) {
        if (isSemanticDropdown(control)) {
            applySemanticDropdownValue(control, []);
            return;
        }
        var tag = (control.tagName || '').toLowerCase();
        var type = String(control.type || '').toLowerCase();
        if (tag === 'select' && control.multiple) {
            for (var i = 0; i < control.options.length; i++) {
                control.options[i].selected = false;
            }
            dispatchControlEvents(control);
            return;
        }
        if (type === 'checkbox' || type === 'radio') {
            setNativeValue(control, 'checked', false);
            dispatchControlEvents(control);
            return;
        }
        setNativeValue(control, 'value', '');
        dispatchControlEvents(control);
    }

    function clearCurrentFilterValues(area) {
        var controls = controlsIn(area, true);
        for (var i = 0; i < controls.length; i++) {
            clearControlValue(controls[i]);
        }
    }

    function applySnapshot(area, snapshot) {
        var current = controlsIn(area, true);
        var identities = [];
        var used = [];
        var applied = 0;
        for (var i = 0; i < current.length; i++) {
            identities.push(controlIdentity(current[i], i));
            used.push(false);
        }
        var items = snapshot && Array.isArray(snapshot.items) ? snapshot.items : [];
        for (var j = 0; j < items.length; j++) {
            var want = items[j].identity;
            var bestIndex = -1;
            var bestScore = -1;
            for (var k = 0; k < identities.length; k++) {
                if (used[k]) {
                    continue;
                }
                var score = identityScore(want, identities[k]);
                if (score > bestScore) {
                    bestScore = score;
                    bestIndex = k;
                }
            }
            if (bestIndex >= 0 && bestScore >= 1) {
                applyControlValue(current[bestIndex], items[j].value);
                used[bestIndex] = true;
                applied++;
            }
        }
        return applied;
    }

    function closestExpandableTitle(title) {
        if (!title) {
            return null;
        }
        if (title.matches && title.matches('summary,button,[role="button"],[aria-expanded]')) {
            return title;
        }
        return title.closest ? title.closest('summary,button,[role="button"],[aria-expanded]') : null;
    }

    function expandAdvancedFilter(title, area, cb) {
        var clicked = false;
        var details =
            (title && title.closest && title.closest('details')) ||
            (area && area.closest && area.closest('details'));
        if (details && !details.open) {
            details.open = true;
        }
        var trigger = closestExpandableTitle(title);
        if (trigger && trigger.getAttribute('aria-expanded') === 'false') {
            clickLikeUser(trigger);
            clicked = true;
        } else if (area && !visible(area) && trigger && trigger.tagName && trigger.tagName.toLowerCase() === 'summary') {
            clickLikeUser(trigger);
            clicked = true;
        }
        if (clicked || (area && !visible(area))) {
            setTimeout(cb, 180);
        } else {
            cb();
        }
    }

    function controlTextForButton(el) {
        if (!el) {
            return '';
        }
        return String(
            (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'))) ||
                el.textContent ||
                ''
        ).replace(/\s+/g, ' ').trim();
    }

    function findClearAllButton(title, area) {
        var roots = [];
        if (area) {
            roots.push(area);
        }
        var p = area && area.parentElement;
        var depth = 0;
        while (p && p !== document.body && depth < 5) {
            roots.push(p);
            p = p.parentElement;
            depth++;
        }
        if (title && roots.indexOf(title.parentElement) < 0) {
            roots.push(title.parentElement);
        }
        for (var r = 0; r < roots.length; r++) {
            var root = roots[r];
            if (!root || !root.querySelectorAll) {
                continue;
            }
            var buttons = root.querySelectorAll('button,[role="button"],a');
            for (var i = 0; i < buttons.length; i++) {
                var txt = controlTextForButton(buttons[i]);
                if (/^clear\s+all$/i.test(txt) || /\bclear\s+all\b/i.test(txt)) {
                    return buttons[i];
                }
            }
        }
        return null;
    }

    function clearBeforeRecall(title, area, cb) {
        var clearBtn = findClearAllButton(title, area);
        if (clearBtn) {
            clickLikeUser(clearBtn);
            setTimeout(function () {
                clearCurrentFilterValues(area);
                cb();
            }, 180);
            return;
        }
        clearCurrentFilterValues(area);
        cb();
    }

    function presetByName(list, name) {
        var lower = String(name || '').toLowerCase();
        for (var i = 0; i < list.length; i++) {
            if (String(list[i].name || '').toLowerCase() === lower) {
                return { item: list[i], index: i };
            }
        }
        return { item: null, index: -1 };
    }

    function sortPresets(list) {
        list.sort(function (a, b) {
            return String(a.name || '').localeCompare(String(b.name || ''), undefined, {
                sensitivity: 'base'
            });
        });
        return list;
    }

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }
        var style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent =
            '.' + BUTTON_CLASS + '{margin-left:8px;padding:3px 8px;border:1px solid #5dade2;border-radius:4px;background:#1a1f28;color:#5dade2;font:12px/1.2 system-ui,sans-serif;cursor:pointer;vertical-align:middle;}' +
            '.' + BUTTON_CLASS + ':hover{background:#203044;}' +
            '#' + PANEL_ID + '{position:absolute;z-index:99999;width:300px;max-width:calc(100vw - 24px);box-sizing:border-box;padding:10px;border:1px solid #3d4f66;border-radius:8px;background:rgba(25,31,42,.98);box-shadow:0 8px 24px rgba(0,0,0,.35);color:#e8eef5;font:12px/1.35 system-ui,sans-serif;}' +
            '#' + PANEL_ID + ' .dc-afss-title{font-weight:700;color:#5dade2;margin-bottom:8px;}' +
            '#' + PANEL_ID + ' .dc-afss-row{display:flex;gap:6px;margin-top:6px;align-items:center;}' +
            '#' + PANEL_ID + ' input,#' + PANEL_ID + ' select{flex:1;min-width:0;padding:4px 6px;border:1px solid #555;border-radius:4px;background:#111821;color:#e8eef5;font:12px system-ui,sans-serif;}' +
            '#' + PANEL_ID + ' button{padding:4px 8px;border:1px solid #5dade2;border-radius:4px;background:#1a1f28;color:#e8eef5;font:12px system-ui,sans-serif;cursor:pointer;}' +
            '#' + PANEL_ID + ' button:hover{background:#26364b;}' +
            '#' + PANEL_ID + ' button[data-dc-afss-delete]{border-color:#8a4b4b;}' +
            '#' + PANEL_ID + ' .dc-afss-folder{font-size:11px;color:#95a5a6;margin-bottom:6px;line-height:1.35;word-break:break-word;}' +
            '#' + PANEL_ID + ' .dc-afss-status{min-height:16px;margin-top:7px;color:#bdc3c7;font-size:11px;}';
        document.head.appendChild(style);
    }

    function optionsHtml(localList, sharedList) {
        var html = '<option value="">Choose saved setting...</option>';
        if (localList && localList.length) {
            html += '<optgroup label="Local">';
            for (var i = 0; i < localList.length; i++) {
                html += '<option value="local:' + htmlEscape(localList[i].name) + '">' + htmlEscape(localList[i].name) + '</option>';
            }
            html += '</optgroup>';
        }
        if (sharedList && sharedList.length) {
            html += '<optgroup label="Shared">';
            for (var j = 0; j < sharedList.length; j++) {
                var optLabel = htmlEscape(sharedList[j].name);
                if (trimText(sharedList[j].createdBy || '')) {
                    optLabel += ' · ' + htmlEscape(trimText(sharedList[j].createdBy));
                }
                html += '<option value="cloud:' + htmlEscape(sharedList[j].id) + '">' + optLabel + '</option>';
            }
            html += '</optgroup>';
        }
        return html;
    }

    function panelHtml(list) {
        var options = optionsHtml(list, cloudPresets);
        return (
            '<div class="dc-afss-folder" data-dc-afss-folder></div>' +
            '<div class="dc-afss-title">Advanced filter settings</div>' +
            '<div class="dc-afss-row">' +
            '<input type="text" data-dc-afss-name placeholder="Name this setting" />' +
            '<button type="button" data-dc-afss-save>Save Local</button>' +
            '<button type="button" data-dc-afss-save-cloud>Save Shared</button>' +
            '</div>' +
            '<div class="dc-afss-row">' +
            '<select data-dc-afss-select>' + options + '</select>' +
            '<button type="button" data-dc-afss-load>Recall</button>' +
            '<button type="button" data-dc-afss-refresh>Refresh Shared</button>' +
            '<button type="button" data-dc-afss-delete>Delete</button>' +
            '</div>' +
            '<div class="dc-afss-status" data-dc-afss-status></div>'
        );
    }

    function setStatus(panel, message) {
        var status = panel && panel.querySelector('[data-dc-afss-status]');
        if (status) {
            status.textContent = message || '';
        }
    }

    function updateSharedFolderBanner(panel) {
        var el = panel && panel.querySelector('[data-dc-afss-folder]');
        if (!el) {
            return;
        }
        var dir = resolvedCloudRootDir();
        if (!advancedFilterMatchDonkeycodeFolder()) {
            el.textContent = 'Shared: ' + dir + ' (session folder matching off)';
            return;
        }
        var fk = sessionFolderKeyCanonical();
        var label = sessionFolderDisplayLabel(fk);
        el.textContent =
            'DonkeyCODE folder: ' + label + (fk !== '__default__' ? ' (' + fk + ')' : '') + ' · repo ' + dir;
    }

    function stopCloudFolderWatch() {
        if (cloudFolderWatchTimer) {
            clearInterval(cloudFolderWatchTimer);
            cloudFolderWatchTimer = 0;
        }
    }

    function scheduleCloudFolderWatch(panel) {
        stopCloudFolderWatch();
        cloudFolderWatchTimer = setInterval(function () {
            if (!panel || !panel.isConnected || panel !== activePanel) {
                stopCloudFolderWatch();
                return;
            }
            var sig = cloudStorageTargetSignature();
            if (sig !== lastCloudTargetSig) {
                lastCloudTargetSig = sig;
                cloudLoaded = false;
                cloudPresets = [];
                updateSharedFolderBanner(panel);
                loadCloudPresets(panel);
            }
        }, 800);
    }

    function refreshPanelOptions(panel) {
        if (!panel) {
            return;
        }
        var select = panel.querySelector('[data-dc-afss-select]');
        if (!select) {
            return;
        }
        var selected = select.value;
        select.innerHTML = optionsHtml(readPagePresets(), cloudPresets);
        select.value = selected;
    }

    function positionPanel(panel, button) {
        var rect = button.getBoundingClientRect();
        panel.style.left = Math.max(8, Math.min(window.innerWidth - panel.offsetWidth - 8, rect.left + window.scrollX)) + 'px';
        panel.style.top = rect.bottom + window.scrollY + 6 + 'px';
    }

    function closePanel() {
        stopCloudFolderWatch();
        if (activePanel) {
            activePanel.remove();
            activePanel = null;
        }
        if (outsideClickHandler) {
            document.removeEventListener('mousedown', outsideClickHandler, true);
            outsideClickHandler = null;
        }
        if (keydownHandler) {
            document.removeEventListener('keydown', keydownHandler, true);
            keydownHandler = null;
        }
    }

    function openPanel(button, title) {
        closePanel();
        ensureStyle();
        var panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.innerHTML = panelHtml(readPagePresets());
        document.body.appendChild(panel);
        positionPanel(panel, button);
        activePanel = panel;
        activeTitle = title;
        lastCloudTargetSig = cloudStorageTargetSignature();
        bindPanel(panel);
        updateSharedFolderBanner(panel);
        scheduleCloudFolderWatch(panel);
        if (!cloudLoaded && !cloudLoading) {
            loadCloudPresets(panel);
        }
        outsideClickHandler = function (ev) {
            if (panel.contains(ev.target) || button.contains(ev.target)) {
                return;
            }
            closePanel();
        };
        keydownHandler = function (ev) {
            if (ev.key === 'Escape') {
                closePanel();
            }
        };
        document.addEventListener('mousedown', outsideClickHandler, true);
        document.addEventListener('keydown', keydownHandler, true);
        var nameInput = panel.querySelector('[data-dc-afss-name]');
        if (nameInput) {
            nameInput.focus();
        }
    }



    function selectedPresetFromControls(select, nameInput) {
        var val = (select && select.value) || '';
        if (val.indexOf('cloud:') === 0) {
            return { item: cloudPresetById(val.slice(6)), source: 'cloud' };
        }
        if (val.indexOf('local:') === 0) {
            return Object.assign(presetByName(readPagePresets(), val.slice(6)), { source: 'local' });
        }
        return Object.assign(presetByName(readPagePresets(), (nameInput && nameInput.value) || ''), { source: 'local' });
    }

    function buildPresetFromArea(name, area) {
        var snap = snapshotArea(area);
        if (!snap.items.length) {
            return null;
        }
        return { name: name, snapshot: snap };
    }

    function saveLocalPreset(preset) {
        var list = readPagePresets();
        var found = presetByName(list, preset.name);
        if (found.index >= 0) {
            list[found.index] = preset;
        } else {
            list.push(preset);
        }
        sortPresets(list);
        return writePagePresets(list);
    }

    function bindPanel(panel) {
        var nameInput = panel.querySelector('[data-dc-afss-name]');
        var select = panel.querySelector('[data-dc-afss-select]');
        var saveBtn = panel.querySelector('[data-dc-afss-save]');
        var saveCloudBtn = panel.querySelector('[data-dc-afss-save-cloud]');
        var refreshBtn = panel.querySelector('[data-dc-afss-refresh]');
        var loadBtn = panel.querySelector('[data-dc-afss-load]');
        var deleteBtn = panel.querySelector('[data-dc-afss-delete]');
        if (select && nameInput) {
            select.addEventListener('change', function () {
                if (select.value) {
                    var chosen = selectedPresetFromControls(select, nameInput);
                    if (chosen && chosen.item) {
                        nameInput.value = chosen.item.name;
                    }
                }
            });
        }
        if (saveBtn) {
            saveBtn.addEventListener('click', function () {
                var title = activeTitle || findAdvancedFilterTitle();
                var area = findFilterArea(title);
                if (!area) {
                    setStatus(panel, 'Could not find the Advanced filter inputs.');
                    return;
                }
                var name = String((nameInput && nameInput.value) || '').replace(/\s+/g, ' ').trim();
                if (!name) {
                    setStatus(panel, 'Enter a name before saving.');
                    return;
                }
                var preset = buildPresetFromArea(name, area);
                if (!preset) {
                    setStatus(panel, 'No inputs found to save.');
                    return;
                }
                if (!saveLocalPreset(preset)) {
                    setStatus(panel, 'Could not save setting. Storage may be full.');
                    return;
                }
                refreshPanelOptions(panel);
                if (select) {
                    select.value = 'local:' + name;
                }
                setStatus(panel, 'Saved local "' + name + '" with ' + preset.snapshot.items.length + ' inputs.');
            });
        }
        if (saveCloudBtn) {
            saveCloudBtn.addEventListener('click', function () {
                var title = activeTitle || findAdvancedFilterTitle();
                var area = findFilterArea(title);
                if (!area) {
                    setStatus(panel, 'Could not find the Advanced filter inputs.');
                    return;
                }
                var name = String((nameInput && nameInput.value) || '').replace(/\s+/g, ' ').trim();
                if (!name) {
                    setStatus(panel, 'Enter a name before saving shared.');
                    return;
                }
                var preset = buildPresetFromArea(name, area);
                if (!preset) {
                    setStatus(panel, 'No inputs found to save.');
                    return;
                }
                saveLocalPreset(preset);
                setStatus(panel, 'Saving shared filter...');
                saveCloudPreset(preset, function (ok, err) {
                    if (!ok) {
                        setStatus(panel, err || 'Shared save failed.');
                        return;
                    }
                    cloudLoaded = true;
                    refreshPanelOptions(panel);
                    setStatus(panel, 'Saved shared "' + name + '".');
                });
            });
        }
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function () {
                loadCloudPresets(panel);
            });
        }
        if (loadBtn) {
            loadBtn.addEventListener('click', function () {
                var title = activeTitle || findAdvancedFilterTitle();
                var area = findFilterArea(title);
                var found = selectedPresetFromControls(select, nameInput);
                if (!area) {
                    setStatus(panel, 'Could not find the Advanced filter inputs.');
                    return;
                }
                if (!found.item) {
                    setStatus(panel, 'Choose a saved setting to recall.');
                    return;
                }
                expandAdvancedFilter(title, area, function () {
                    var freshArea = findFilterArea(title) || area;
                    clearBeforeRecall(title, freshArea, function () {
                        var applyArea = findFilterArea(title) || freshArea;
                        var count = applySnapshot(applyArea, found.item.snapshot);
                        setStatus(panel, 'Recalled "' + found.item.name + '" to ' + count + ' inputs.');
                    });
                });
            });
        }
        if (deleteBtn) {
            deleteBtn.addEventListener('click', function () {
                var found = selectedPresetFromControls(select, nameInput);
                if (found.source === 'cloud') {
                    setStatus(panel, 'Shared delete is not enabled yet; delete local presets only.');
                    return;
                }
                if (!found.item) {
                    setStatus(panel, 'Choose a saved setting to delete.');
                    return;
                }
                var list = readPagePresets();
                list.splice(found.index, 1);
                writePagePresets(list);
                refreshPanelOptions(panel);
                setStatus(panel, 'Deleted "' + found.item.name + '".');
            });
        }
    }

    function mountButton(title) {
        if (!title || title.querySelector('.' + BUTTON_CLASS)) {
            return;
        }
        ensureStyle();
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = BUTTON_CLASS;
        btn.textContent = 'Save/Recall';
        btn.title = 'Save or recall named Advanced filter settings';
        btn.addEventListener('click', function (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            if (activePanel) {
                closePanel();
            } else {
                openPanel(btn, title);
            }
        });
        title.appendChild(btn);
    }

    function scan() {
        rescanTimer = 0;
        var title = findAdvancedFilterTitle();
        if (title) {
            mountButton(title);
        }
    }

    function scheduleScan() {
        if (rescanTimer) {
            return;
        }
        rescanTimer = setTimeout(scan, 150);
    }

    function init() {
        scan();
        observer = new MutationObserver(scheduleScan);
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }

    window.__myScriptCleanup = function () {
        stopCloudFolderWatch();
        closePanel();
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        if (rescanTimer) {
            clearTimeout(rescanTimer);
            rescanTimer = 0;
        }
        var buttons = document.querySelectorAll('.' + BUTTON_CLASS);
        for (var i = 0; i < buttons.length; i++) {
            buttons[i].remove();
        }
        var style = document.getElementById(STYLE_ID);
        if (style) {
            style.remove();
        }
        window.__myScriptCleanup = undefined;
    };
})();
