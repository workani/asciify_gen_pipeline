(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/app/demo/page.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>DemoPage
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$Dashboard$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/Dashboard.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$source$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/source.ts [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature();
"use client";
;
;
function DemoPage() {
    _s();
    const { snapshot, connection, restart } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$source$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRunFeed"])("demo");
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$Dashboard$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Dashboard"], {
        snapshot: snapshot,
        connection: connection,
        title: "Miner",
        onRestart: restart
    }, void 0, false, {
        fileName: "[project]/app/demo/page.tsx",
        lineNumber: 10,
        columnNumber: 5
    }, this);
}
_s(DemoPage, "FvSS3HNewgOVeavdbKGwJty1dQk=", false, function() {
    return [
        __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$source$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRunFeed"]
    ];
});
_c = DemoPage;
var _c;
__turbopack_context__.k.register(_c, "DemoPage");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/components/Dashboard.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Dashboard",
    ()=>Dashboard
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/client/app-dir/link.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__ = __turbopack_context__.i("[project]/components/dashboard.module.css [app-client] (css module)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$Meter$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/Meter.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$StageStrip$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/components/StageStrip.tsx [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$tone$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/tone.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$format$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/format.ts [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature();
"use client";
;
;
;
;
;
;
;
const STALE_AFTER = 10;
function Dashboard({ snapshot: s, connection, title = "Miner", onRestart }) {
    const running = s.status === "running" || s.status === "starting";
    // A run that has stopped producing events is not a run you are watching.
    // Saying so beats showing a frozen frame that looks live.
    const stale = running && s.idle > STALE_AFTER;
    const empty = s.overall.sitesTotal === 0;
    const tone = stale ? "warn" : (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$tone$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["runTone"])(s.status);
    const live = running && !stale;
    const ident = [
        s.release,
        s.manifest,
        s.workDir
    ].filter(Boolean);
    const storage = s.storage.used !== null && s.storage.limit ? Math.min(1, s.storage.used / s.storage.limit) : null;
    const flagged = Object.entries(s.warnings).filter(([, v])=>v);
    const netLive = s.network.last !== null && s.idle < 2;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].shell,
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("header", {
                className: `${__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].top} ${__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].pad}`,
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                    className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].inner,
                    children: [
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                            className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].topRow,
                            children: [
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                    className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].mark,
                                    style: (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$tone$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["toneVars"])(tone),
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                            className: `${__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].blip} ${live ? __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].blipLive : ""}`
                                        }, void 0, false, {
                                            fileName: "[project]/components/Dashboard.tsx",
                                            lineNumber: 51,
                                            columnNumber: 15
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                            className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].title,
                                            children: title
                                        }, void 0, false, {
                                            fileName: "[project]/components/Dashboard.tsx",
                                            lineNumber: 52,
                                            columnNumber: 15
                                        }, this)
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/components/Dashboard.tsx",
                                    lineNumber: 50,
                                    columnNumber: 13
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                    className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].readouts,
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("time", {
                                            className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].clock,
                                            children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$format$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["humanDuration"])(s.elapsed)
                                        }, void 0, false, {
                                            fileName: "[project]/components/Dashboard.tsx",
                                            lineNumber: 55,
                                            columnNumber: 15
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                            className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].state,
                                            style: (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$tone$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["toneVars"])(tone),
                                            children: __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$tone$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["RUN_LABEL"][s.status]
                                        }, void 0, false, {
                                            fileName: "[project]/components/Dashboard.tsx",
                                            lineNumber: 56,
                                            columnNumber: 15
                                        }, this)
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/components/Dashboard.tsx",
                                    lineNumber: 54,
                                    columnNumber: 13
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                    className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].tools,
                                    children: [
                                        onRestart ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                                            className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].tool,
                                            onClick: onRestart,
                                            title: "Replay",
                                            children: [
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("svg", {
                                                    viewBox: "0 0 24 24",
                                                    "aria-hidden": true,
                                                    children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("path", {
                                                        d: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5",
                                                        strokeLinecap: "round",
                                                        strokeLinejoin: "round"
                                                    }, void 0, false, {
                                                        fileName: "[project]/components/Dashboard.tsx",
                                                        lineNumber: 64,
                                                        columnNumber: 21
                                                    }, this)
                                                }, void 0, false, {
                                                    fileName: "[project]/components/Dashboard.tsx",
                                                    lineNumber: 63,
                                                    columnNumber: 19
                                                }, this),
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                    className: "srOnly",
                                                    children: "Replay the demo run"
                                                }, void 0, false, {
                                                    fileName: "[project]/components/Dashboard.tsx",
                                                    lineNumber: 66,
                                                    columnNumber: 19
                                                }, this)
                                            ]
                                        }, void 0, true, {
                                            fileName: "[project]/components/Dashboard.tsx",
                                            lineNumber: 62,
                                            columnNumber: 17
                                        }, this) : null,
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"], {
                                            className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].tool,
                                            href: onRestart ? "/" : "/demo",
                                            title: onRestart ? "Live run" : "Demo run",
                                            children: [
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("svg", {
                                                    viewBox: "0 0 24 24",
                                                    "aria-hidden": true,
                                                    children: onRestart ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("path", {
                                                        d: "M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1",
                                                        strokeLinecap: "round"
                                                    }, void 0, false, {
                                                        fileName: "[project]/components/Dashboard.tsx",
                                                        lineNumber: 76,
                                                        columnNumber: 21
                                                    }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("path", {
                                                        d: "M8 5v14l11-7z",
                                                        strokeLinejoin: "round"
                                                    }, void 0, false, {
                                                        fileName: "[project]/components/Dashboard.tsx",
                                                        lineNumber: 78,
                                                        columnNumber: 21
                                                    }, this)
                                                }, void 0, false, {
                                                    fileName: "[project]/components/Dashboard.tsx",
                                                    lineNumber: 74,
                                                    columnNumber: 17
                                                }, this),
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                    className: "srOnly",
                                                    children: onRestart ? "Switch to the live run" : "Watch a demo run"
                                                }, void 0, false, {
                                                    fileName: "[project]/components/Dashboard.tsx",
                                                    lineNumber: 81,
                                                    columnNumber: 17
                                                }, this)
                                            ]
                                        }, void 0, true, {
                                            fileName: "[project]/components/Dashboard.tsx",
                                            lineNumber: 69,
                                            columnNumber: 15
                                        }, this)
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/components/Dashboard.tsx",
                                    lineNumber: 60,
                                    columnNumber: 13
                                }, this)
                            ]
                        }, void 0, true, {
                            fileName: "[project]/components/Dashboard.tsx",
                            lineNumber: 49,
                            columnNumber: 11
                        }, this),
                        (ident.length || connection !== "open" || stale || empty) && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                            className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].ident,
                            children: [
                                ident.map((value)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].identItem,
                                        title: value,
                                        children: value
                                    }, value, false, {
                                        fileName: "[project]/components/Dashboard.tsx",
                                        lineNumber: 88,
                                        columnNumber: 17
                                    }, this)),
                                stale && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: `${__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].identItem} ${__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].identWarn}`,
                                    children: [
                                        "no events for ",
                                        (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$format$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["compactDuration"])(s.idle)
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/components/Dashboard.tsx",
                                    lineNumber: 93,
                                    columnNumber: 17
                                }, this),
                                empty && connection === "open" && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].identItem,
                                    children: "waiting for a run"
                                }, void 0, false, {
                                    fileName: "[project]/components/Dashboard.tsx",
                                    lineNumber: 98,
                                    columnNumber: 17
                                }, this),
                                connection === "connecting" && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].identItem,
                                    children: "connecting…"
                                }, void 0, false, {
                                    fileName: "[project]/components/Dashboard.tsx",
                                    lineNumber: 100,
                                    columnNumber: 47
                                }, this),
                                connection === "error" && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].identItem,
                                    children: "stream lost"
                                }, void 0, false, {
                                    fileName: "[project]/components/Dashboard.tsx",
                                    lineNumber: 101,
                                    columnNumber: 42
                                }, this),
                                connection === "closed" && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].identItem,
                                    children: "stream ended"
                                }, void 0, false, {
                                    fileName: "[project]/components/Dashboard.tsx",
                                    lineNumber: 102,
                                    columnNumber: 43
                                }, this)
                            ]
                        }, void 0, true, {
                            fileName: "[project]/components/Dashboard.tsx",
                            lineNumber: 86,
                            columnNumber: 13
                        }, this)
                    ]
                }, void 0, true, {
                    fileName: "[project]/components/Dashboard.tsx",
                    lineNumber: 48,
                    columnNumber: 9
                }, this)
            }, void 0, false, {
                fileName: "[project]/components/Dashboard.tsx",
                lineNumber: 47,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("section", {
                className: `${__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].section} ${__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].pad}`,
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                    className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].inner,
                    children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].overall,
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].groups,
                                title: `${s.overall.stages} of ${s.overall.stagesTotal} stages, ${s.overall.sites} of ${s.overall.sitesTotal} sites complete`,
                                children: s.sites.length ? s.sites.map((site)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$StageStrip$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["StageStrip"], {
                                        phases: site.phases
                                    }, site.site, false, {
                                        fileName: "[project]/components/Dashboard.tsx",
                                        lineNumber: 116,
                                        columnNumber: 39
                                    }, this)) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].seg
                                }, void 0, false, {
                                    fileName: "[project]/components/Dashboard.tsx",
                                    lineNumber: 118,
                                    columnNumber: 17
                                }, this)
                            }, void 0, false, {
                                fileName: "[project]/components/Dashboard.tsx",
                                lineNumber: 111,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].tally,
                                children: [
                                    s.overall.stages,
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].tallySub,
                                        children: [
                                            "/",
                                            s.overall.stagesTotal
                                        ]
                                    }, void 0, true, {
                                        fileName: "[project]/components/Dashboard.tsx",
                                        lineNumber: 124,
                                        columnNumber: 15
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/components/Dashboard.tsx",
                                lineNumber: 122,
                                columnNumber: 13
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/components/Dashboard.tsx",
                        lineNumber: 110,
                        columnNumber: 11
                    }, this)
                }, void 0, false, {
                    fileName: "[project]/components/Dashboard.tsx",
                    lineNumber: 109,
                    columnNumber: 9
                }, this)
            }, void 0, false, {
                fileName: "[project]/components/Dashboard.tsx",
                lineNumber: 108,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("section", {
                className: `${__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].section} ${__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].pad}`,
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                    className: `${__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].inner} ${__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].grid}`,
                    children: [
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(ActiveStage, {
                            snapshot: s
                        }, void 0, false, {
                            fileName: "[project]/components/Dashboard.tsx",
                            lineNumber: 132,
                            columnNumber: 11
                        }, this),
                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                            className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].stack,
                            children: [
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                    className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].sites,
                                    children: s.sites.map((site)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                            className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].site,
                                            style: (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$tone$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["toneVars"])((0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$tone$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["siteTone"])(site.status)),
                                            children: [
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                    className: `${__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].blip} ${site.status === "active" ? __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].blipLive : ""}`
                                                }, void 0, false, {
                                                    fileName: "[project]/components/Dashboard.tsx",
                                                    lineNumber: 137,
                                                    columnNumber: 19
                                                }, this),
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                    className: `${__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].siteName} ${site.status !== "pending" ? __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].siteOn : ""}`,
                                                    title: site.site,
                                                    children: site.site
                                                }, void 0, false, {
                                                    fileName: "[project]/components/Dashboard.tsx",
                                                    lineNumber: 138,
                                                    columnNumber: 19
                                                }, this),
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$StageStrip$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["StageStrip"], {
                                                    phases: site.phases,
                                                    className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].siteBar
                                                }, void 0, false, {
                                                    fileName: "[project]/components/Dashboard.tsx",
                                                    lineNumber: 144,
                                                    columnNumber: 19
                                                }, this),
                                                site.status === "active" && site.stage ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                    className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].siteStage,
                                                    children: site.stage
                                                }, void 0, false, {
                                                    fileName: "[project]/components/Dashboard.tsx",
                                                    lineNumber: 146,
                                                    columnNumber: 21
                                                }, this) : null,
                                                site.missingOptional.length ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                    className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].siteStage,
                                                    children: [
                                                        "no ",
                                                        site.missingOptional.join(", ")
                                                    ]
                                                }, void 0, true, {
                                                    fileName: "[project]/components/Dashboard.tsx",
                                                    lineNumber: 149,
                                                    columnNumber: 21
                                                }, this) : null
                                            ]
                                        }, site.site, true, {
                                            fileName: "[project]/components/Dashboard.tsx",
                                            lineNumber: 136,
                                            columnNumber: 17
                                        }, this))
                                }, void 0, false, {
                                    fileName: "[project]/components/Dashboard.tsx",
                                    lineNumber: 134,
                                    columnNumber: 13
                                }, this),
                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                            className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].stats,
                                            children: [
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(Stat, {
                                                    value: s.metrics.candidates,
                                                    label: "candidates"
                                                }, void 0, false, {
                                                    fileName: "[project]/components/Dashboard.tsx",
                                                    lineNumber: 157,
                                                    columnNumber: 17
                                                }, this),
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(Stat, {
                                                    value: s.metrics.documents,
                                                    label: "documents"
                                                }, void 0, false, {
                                                    fileName: "[project]/components/Dashboard.tsx",
                                                    lineNumber: 158,
                                                    columnNumber: 17
                                                }, this),
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(Stat, {
                                                    value: s.metrics.discoveryHits,
                                                    label: "hits"
                                                }, void 0, false, {
                                                    fileName: "[project]/components/Dashboard.tsx",
                                                    lineNumber: 159,
                                                    columnNumber: 17
                                                }, this)
                                            ]
                                        }, void 0, true, {
                                            fileName: "[project]/components/Dashboard.tsx",
                                            lineNumber: 156,
                                            columnNumber: 15
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                            className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].gauge,
                                            children: [
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                    className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].gaugeRow,
                                                    children: [
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                            children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$format$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["humanBytes"])(s.storage.used)
                                                        }, void 0, false, {
                                                            fileName: "[project]/components/Dashboard.tsx",
                                                            lineNumber: 164,
                                                            columnNumber: 19
                                                        }, this),
                                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                            className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].gaugeCap,
                                                            children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$format$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["humanBytes"])(s.storage.limit)
                                                        }, void 0, false, {
                                                            fileName: "[project]/components/Dashboard.tsx",
                                                            lineNumber: 165,
                                                            columnNumber: 19
                                                        }, this)
                                                    ]
                                                }, void 0, true, {
                                                    fileName: "[project]/components/Dashboard.tsx",
                                                    lineNumber: 163,
                                                    columnNumber: 17
                                                }, this),
                                                /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$Meter$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Meter"], {
                                                    percent: storage,
                                                    small: true,
                                                    tone: storage === null ? "mute" : storage > 0.95 ? "err" : storage > 0.8 ? "warn" : "ok",
                                                    label: "Working storage against the configured budget"
                                                }, void 0, false, {
                                                    fileName: "[project]/components/Dashboard.tsx",
                                                    lineNumber: 167,
                                                    columnNumber: 17
                                                }, this)
                                            ]
                                        }, void 0, true, {
                                            fileName: "[project]/components/Dashboard.tsx",
                                            lineNumber: 162,
                                            columnNumber: 15
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                            className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].gauge,
                                            children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].net,
                                                children: [
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].blip,
                                                        style: (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$tone$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["toneVars"])(netLive ? "ok" : "mute")
                                                    }, void 0, false, {
                                                        fileName: "[project]/components/Dashboard.tsx",
                                                        lineNumber: 178,
                                                        columnNumber: 19
                                                    }, this),
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                        children: [
                                                            (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$format$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["humanCount"])(s.network.requests),
                                                            " req"
                                                        ]
                                                    }, void 0, true, {
                                                        fileName: "[project]/components/Dashboard.tsx",
                                                        lineNumber: 179,
                                                        columnNumber: 19
                                                    }, this),
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].gaugeCap,
                                                        children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$format$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["humanBytes"])(s.network.bytes)
                                                    }, void 0, false, {
                                                        fileName: "[project]/components/Dashboard.tsx",
                                                        lineNumber: 180,
                                                        columnNumber: 19
                                                    }, this),
                                                    s.network.note ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                        className: /retry|retrying/i.test(s.network.note) ? __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].netWarn : __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].netNote,
                                                        children: s.network.note
                                                    }, void 0, false, {
                                                        fileName: "[project]/components/Dashboard.tsx",
                                                        lineNumber: 182,
                                                        columnNumber: 21
                                                    }, this) : null
                                                ]
                                            }, void 0, true, {
                                                fileName: "[project]/components/Dashboard.tsx",
                                                lineNumber: 177,
                                                columnNumber: 17
                                            }, this)
                                        }, void 0, false, {
                                            fileName: "[project]/components/Dashboard.tsx",
                                            lineNumber: 176,
                                            columnNumber: 15
                                        }, this)
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/components/Dashboard.tsx",
                                    lineNumber: 155,
                                    columnNumber: 13
                                }, this),
                                s.reason || flagged.length ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                    className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].banner,
                                    style: (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$tone$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["toneVars"])(tone),
                                    children: [
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                            className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].blip
                                        }, void 0, false, {
                                            fileName: "[project]/components/Dashboard.tsx",
                                            lineNumber: 196,
                                            columnNumber: 17
                                        }, this),
                                        /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                            className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].bannerBody,
                                            children: [
                                                s.reason ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                                    children: s.reason
                                                }, void 0, false, {
                                                    fileName: "[project]/components/Dashboard.tsx",
                                                    lineNumber: 198,
                                                    columnNumber: 31
                                                }, this) : null,
                                                flagged.length ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                                    className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].warnings,
                                                    children: flagged.map(([k, v])=>`${k.replace(/_/g, " ")} ${v}`).join(" · ")
                                                }, void 0, false, {
                                                    fileName: "[project]/components/Dashboard.tsx",
                                                    lineNumber: 200,
                                                    columnNumber: 21
                                                }, this) : null
                                            ]
                                        }, void 0, true, {
                                            fileName: "[project]/components/Dashboard.tsx",
                                            lineNumber: 197,
                                            columnNumber: 17
                                        }, this)
                                    ]
                                }, void 0, true, {
                                    fileName: "[project]/components/Dashboard.tsx",
                                    lineNumber: 195,
                                    columnNumber: 15
                                }, this) : null
                            ]
                        }, void 0, true, {
                            fileName: "[project]/components/Dashboard.tsx",
                            lineNumber: 133,
                            columnNumber: 11
                        }, this)
                    ]
                }, void 0, true, {
                    fileName: "[project]/components/Dashboard.tsx",
                    lineNumber: 131,
                    columnNumber: 9
                }, this)
            }, void 0, false, {
                fileName: "[project]/components/Dashboard.tsx",
                lineNumber: 130,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(LogFeed, {
                entries: s.log
            }, void 0, false, {
                fileName: "[project]/components/Dashboard.tsx",
                lineNumber: 211,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/components/Dashboard.tsx",
        lineNumber: 46,
        columnNumber: 5
    }, this);
}
_c = Dashboard;
function Stat({ value, label }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].stat,
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].statValue,
                children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$format$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["humanCount"])(value)
            }, void 0, false, {
                fileName: "[project]/components/Dashboard.tsx",
                lineNumber: 219,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                className: `label ${__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].statLabel}`,
                children: label
            }, void 0, false, {
                fileName: "[project]/components/Dashboard.tsx",
                lineNumber: 220,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/components/Dashboard.tsx",
        lineNumber: 218,
        columnNumber: 5
    }, this);
}
_c1 = Stat;
function ActiveStage({ snapshot: s }) {
    const a = s.active;
    if (!a) {
        return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
            children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].idle,
                children: s.status === "starting" ? "Starting up…" : "No stage running"
            }, void 0, false, {
                fileName: "[project]/components/Dashboard.tsx",
                lineNumber: 230,
                columnNumber: 9
            }, this)
        }, void 0, false, {
            fileName: "[project]/components/Dashboard.tsx",
            lineNumber: 229,
            columnNumber: 7
        }, this);
    }
    const replaying = a.replaying;
    const known = replaying ? a.replayTarget > 0 : Boolean(a.total);
    const counted = replaying ? a.replayed : a.observed;
    const denominator = replaying ? a.replayTarget : a.total;
    const rate = replaying ? a.replayRate : a.rate;
    const waiting = !replaying && !a.observed;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].stageHead,
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].stageSite,
                        title: a.site,
                        children: a.site
                    }, void 0, false, {
                        fileName: "[project]/components/Dashboard.tsx",
                        lineNumber: 247,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("h2", {
                        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].stageName,
                        children: a.label
                    }, void 0, false, {
                        fileName: "[project]/components/Dashboard.tsx",
                        lineNumber: 250,
                        columnNumber: 9
                    }, this),
                    replaying ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].tag,
                        children: "replay"
                    }, void 0, false, {
                        fileName: "[project]/components/Dashboard.tsx",
                        lineNumber: 251,
                        columnNumber: 22
                    }, this) : null
                ]
            }, void 0, true, {
                fileName: "[project]/components/Dashboard.tsx",
                lineNumber: 246,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$Meter$2e$tsx__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Meter"], {
                percent: known ? a.percent : null,
                tone: replaying ? "warn" : "info",
                label: a.label
            }, void 0, false, {
                fileName: "[project]/components/Dashboard.tsx",
                lineNumber: 254,
                columnNumber: 7
            }, this),
            waiting ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].foot,
                children: a.note ?? s.network.note ?? "working"
            }, void 0, false, {
                fileName: "[project]/components/Dashboard.tsx",
                lineNumber: 261,
                columnNumber: 9
            }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Fragment"], {
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].readout,
                        children: [
                            known ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Fragment"], {
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].big,
                                        children: [
                                            ((a.percent ?? 0) * 100).toFixed(1),
                                            "%"
                                        ]
                                    }, void 0, true, {
                                        fileName: "[project]/components/Dashboard.tsx",
                                        lineNumber: 267,
                                        columnNumber: 17
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].of,
                                        children: [
                                            (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$format$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["humanCount"])(counted),
                                            " / ",
                                            (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$format$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["humanCount"])(denominator)
                                        ]
                                    }, void 0, true, {
                                        fileName: "[project]/components/Dashboard.tsx",
                                        lineNumber: 268,
                                        columnNumber: 17
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/components/Dashboard.tsx",
                                lineNumber: 266,
                                columnNumber: 15
                            }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Fragment"], {
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].big,
                                        children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$format$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["humanCount"])(counted)
                                    }, void 0, false, {
                                        fileName: "[project]/components/Dashboard.tsx",
                                        lineNumber: 275,
                                        columnNumber: 17
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].of,
                                        children: a.unit
                                    }, void 0, false, {
                                        fileName: "[project]/components/Dashboard.tsx",
                                        lineNumber: 276,
                                        columnNumber: 17
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/components/Dashboard.tsx",
                                lineNumber: 273,
                                columnNumber: 15
                            }, this),
                            rate ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: `${__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].aside} ${__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].push}`,
                                children: [
                                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$format$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["humanRate"])(rate, a.unit),
                                    a.eta !== null ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Fragment"], {
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].sep,
                                                children: "·"
                                            }, void 0, false, {
                                                fileName: "[project]/components/Dashboard.tsx",
                                                lineNumber: 284,
                                                columnNumber: 21
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].etaTag,
                                                children: "eta"
                                            }, void 0, false, {
                                                fileName: "[project]/components/Dashboard.tsx",
                                                lineNumber: 285,
                                                columnNumber: 21
                                            }, this),
                                            " ",
                                            (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$format$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["compactDuration"])(a.eta)
                                        ]
                                    }, void 0, true, {
                                        fileName: "[project]/components/Dashboard.tsx",
                                        lineNumber: 283,
                                        columnNumber: 19
                                    }, this) : null
                                ]
                            }, void 0, true, {
                                fileName: "[project]/components/Dashboard.tsx",
                                lineNumber: 280,
                                columnNumber: 15
                            }, this) : null
                        ]
                    }, void 0, true, {
                        fileName: "[project]/components/Dashboard.tsx",
                        lineNumber: 264,
                        columnNumber: 11
                    }, this),
                    a.unit === "rows" ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].foot,
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                children: [
                                    "committed ",
                                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$format$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["humanCount"])(a.committed)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/components/Dashboard.tsx",
                                lineNumber: 294,
                                columnNumber: 15
                            }, this),
                            a.committedAt ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$format$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["clockTime"])(a.committedAt)
                            }, void 0, false, {
                                fileName: "[project]/components/Dashboard.tsx",
                                lineNumber: 295,
                                columnNumber: 32
                            }, this) : null,
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                children: [
                                    "+",
                                    (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$format$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["humanCount"])(s.rowsThisRun),
                                    " this run"
                                ]
                            }, void 0, true, {
                                fileName: "[project]/components/Dashboard.tsx",
                                lineNumber: 296,
                                columnNumber: 15
                            }, this),
                            a.note ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                children: a.note
                            }, void 0, false, {
                                fileName: "[project]/components/Dashboard.tsx",
                                lineNumber: 297,
                                columnNumber: 25
                            }, this) : null
                        ]
                    }, void 0, true, {
                        fileName: "[project]/components/Dashboard.tsx",
                        lineNumber: 293,
                        columnNumber: 13
                    }, this) : null
                ]
            }, void 0, true, {
                fileName: "[project]/components/Dashboard.tsx",
                lineNumber: 263,
                columnNumber: 9
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/components/Dashboard.tsx",
        lineNumber: 245,
        columnNumber: 5
    }, this);
}
_c2 = ActiveStage;
function LogFeed({ entries }) {
    _s();
    const box = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    const stick = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(true);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "LogFeed.useEffect": ()=>{
            const node = box.current;
            if (node && stick.current) node.scrollTop = node.scrollHeight;
        }
    }["LogFeed.useEffect"], [
        entries
    ]);
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: `${__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].logWrap} ${__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].pad}`,
        children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
            className: `${__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].inner} ${__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].log}`,
            ref: box,
            onScroll: (e)=>{
                const el = e.currentTarget;
                stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            },
            children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].logList,
                children: entries.map((entry)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: `${__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].line} ${entry.level === "warn" ? __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].warn : ""} ${entry.level === "error" ? __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].error : ""}`,
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].lineAt,
                                children: (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$format$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["clockTime"])(entry.at)
                            }, void 0, false, {
                                fileName: "[project]/components/Dashboard.tsx",
                                lineNumber: 333,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].lineText,
                                children: entry.text
                            }, void 0, false, {
                                fileName: "[project]/components/Dashboard.tsx",
                                lineNumber: 334,
                                columnNumber: 13
                            }, this)
                        ]
                    }, entry.id, true, {
                        fileName: "[project]/components/Dashboard.tsx",
                        lineNumber: 327,
                        columnNumber: 11
                    }, this))
            }, void 0, false, {
                fileName: "[project]/components/Dashboard.tsx",
                lineNumber: 325,
                columnNumber: 9
            }, this)
        }, void 0, false, {
            fileName: "[project]/components/Dashboard.tsx",
            lineNumber: 317,
            columnNumber: 7
        }, this)
    }, void 0, false, {
        fileName: "[project]/components/Dashboard.tsx",
        lineNumber: 316,
        columnNumber: 5
    }, this);
}
_s(LogFeed, "6y3heJosBl84ca3xNndtOiiDB3g=");
_c3 = LogFeed;
var _c, _c1, _c2, _c3;
__turbopack_context__.k.register(_c, "Dashboard");
__turbopack_context__.k.register(_c1, "Stat");
__turbopack_context__.k.register(_c2, "ActiveStage");
__turbopack_context__.k.register(_c3, "LogFeed");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/components/Meter.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "Meter",
    ()=>Meter
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__ = __turbopack_context__.i("[project]/components/dashboard.module.css [app-client] (css module)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$tone$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/tone.ts [app-client] (ecmascript)");
;
;
;
function Meter({ percent, tone = "ok", small, label }) {
    const known = percent !== null && percent !== undefined;
    const classes = [
        __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].meter
    ];
    if (small) classes.push(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].meterSm);
    if (!known) classes.push(__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].sweep);
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: classes.join(" "),
        style: (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$tone$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["toneVars"])(tone),
        role: "progressbar",
        "aria-label": label,
        "aria-valuemin": known ? 0 : undefined,
        "aria-valuemax": known ? 100 : undefined,
        "aria-valuenow": known ? Math.round(percent * 100) : undefined,
        "aria-valuetext": known ? undefined : "in progress, total unknown",
        children: known ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
            className: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].fill,
            style: {
                width: `${Math.min(100, percent * 100)}%`
            }
        }, void 0, false, {
            fileName: "[project]/components/Meter.tsx",
            lineNumber: 31,
            columnNumber: 9
        }, this) : null
    }, void 0, false, {
        fileName: "[project]/components/Meter.tsx",
        lineNumber: 20,
        columnNumber: 5
    }, this);
}
_c = Meter;
var _c;
__turbopack_context__.k.register(_c, "Meter");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/components/StageStrip.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "StageStrip",
    ()=>StageStrip
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__ = __turbopack_context__.i("[project]/components/dashboard.module.css [app-client] (css module)");
;
;
const SEG = {
    complete: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].segDone,
    active: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].segActive,
    skipped: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].segSkip,
    failed: __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].segFail
};
function StageStrip({ phases, className }) {
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
        className: className ?? __TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].group,
        children: phases.map((p)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                className: `${__TURBOPACK__imported__module__$5b$project$5d2f$components$2f$dashboard$2e$module$2e$css__$5b$app$2d$client$5d$__$28$css__module$29$__["default"].seg} ${SEG[p.status] ?? ""}`,
                title: `${p.label} — ${p.status}`
            }, p.phase, false, {
                fileName: "[project]/components/StageStrip.tsx",
                lineNumber: 23,
                columnNumber: 9
            }, this))
    }, void 0, false, {
        fileName: "[project]/components/StageStrip.tsx",
        lineNumber: 21,
        columnNumber: 5
    }, this);
}
_c = StageStrip;
var _c;
__turbopack_context__.k.register(_c, "StageStrip");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/components/dashboard.module.css [app-client] (css module)", ((__turbopack_context__) => {

__turbopack_context__.v({
  "aside": "dashboard-module__Mm8Ika__aside",
  "banner": "dashboard-module__Mm8Ika__banner",
  "bannerBody": "dashboard-module__Mm8Ika__bannerBody",
  "big": "dashboard-module__Mm8Ika__big",
  "blip": "dashboard-module__Mm8Ika__blip",
  "blipLive": "dashboard-module__Mm8Ika__blipLive",
  "clock": "dashboard-module__Mm8Ika__clock",
  "error": "dashboard-module__Mm8Ika__error",
  "etaTag": "dashboard-module__Mm8Ika__etaTag",
  "fill": "dashboard-module__Mm8Ika__fill",
  "foot": "dashboard-module__Mm8Ika__foot",
  "gauge": "dashboard-module__Mm8Ika__gauge",
  "gaugeCap": "dashboard-module__Mm8Ika__gaugeCap",
  "gaugeRow": "dashboard-module__Mm8Ika__gaugeRow",
  "grid": "dashboard-module__Mm8Ika__grid",
  "group": "dashboard-module__Mm8Ika__group",
  "groups": "dashboard-module__Mm8Ika__groups",
  "ident": "dashboard-module__Mm8Ika__ident",
  "identItem": "dashboard-module__Mm8Ika__identItem",
  "identWarn": "dashboard-module__Mm8Ika__identWarn",
  "idle": "dashboard-module__Mm8Ika__idle",
  "inner": "dashboard-module__Mm8Ika__inner",
  "line": "dashboard-module__Mm8Ika__line",
  "lineAt": "dashboard-module__Mm8Ika__lineAt",
  "lineText": "dashboard-module__Mm8Ika__lineText",
  "log": "dashboard-module__Mm8Ika__log",
  "logList": "dashboard-module__Mm8Ika__logList",
  "logWrap": "dashboard-module__Mm8Ika__logWrap",
  "mark": "dashboard-module__Mm8Ika__mark",
  "meter": "dashboard-module__Mm8Ika__meter",
  "meterSm": "dashboard-module__Mm8Ika__meterSm",
  "net": "dashboard-module__Mm8Ika__net",
  "netNote": "dashboard-module__Mm8Ika__netNote",
  "netWarn": "dashboard-module__Mm8Ika__netWarn",
  "of": "dashboard-module__Mm8Ika__of",
  "overall": "dashboard-module__Mm8Ika__overall",
  "pad": "dashboard-module__Mm8Ika__pad",
  "pulse": "dashboard-module__Mm8Ika__pulse",
  "push": "dashboard-module__Mm8Ika__push",
  "readout": "dashboard-module__Mm8Ika__readout",
  "readouts": "dashboard-module__Mm8Ika__readouts",
  "section": "dashboard-module__Mm8Ika__section",
  "seg": "dashboard-module__Mm8Ika__seg",
  "segActive": "dashboard-module__Mm8Ika__segActive",
  "segDone": "dashboard-module__Mm8Ika__segDone",
  "segFail": "dashboard-module__Mm8Ika__segFail",
  "segSkip": "dashboard-module__Mm8Ika__segSkip",
  "sep": "dashboard-module__Mm8Ika__sep",
  "shell": "dashboard-module__Mm8Ika__shell",
  "site": "dashboard-module__Mm8Ika__site",
  "siteBar": "dashboard-module__Mm8Ika__siteBar",
  "siteName": "dashboard-module__Mm8Ika__siteName",
  "siteOn": "dashboard-module__Mm8Ika__siteOn",
  "siteStage": "dashboard-module__Mm8Ika__siteStage",
  "sites": "dashboard-module__Mm8Ika__sites",
  "stack": "dashboard-module__Mm8Ika__stack",
  "stageHead": "dashboard-module__Mm8Ika__stageHead",
  "stageName": "dashboard-module__Mm8Ika__stageName",
  "stageSite": "dashboard-module__Mm8Ika__stageSite",
  "stat": "dashboard-module__Mm8Ika__stat",
  "statLabel": "dashboard-module__Mm8Ika__statLabel",
  "statValue": "dashboard-module__Mm8Ika__statValue",
  "state": "dashboard-module__Mm8Ika__state",
  "stats": "dashboard-module__Mm8Ika__stats",
  "sweep": "dashboard-module__Mm8Ika__sweep",
  "tag": "dashboard-module__Mm8Ika__tag",
  "tally": "dashboard-module__Mm8Ika__tally",
  "tallySub": "dashboard-module__Mm8Ika__tallySub",
  "title": "dashboard-module__Mm8Ika__title",
  "tool": "dashboard-module__Mm8Ika__tool",
  "toolOn": "dashboard-module__Mm8Ika__toolOn",
  "tools": "dashboard-module__Mm8Ika__tools",
  "top": "dashboard-module__Mm8Ika__top",
  "topRow": "dashboard-module__Mm8Ika__topRow",
  "warn": "dashboard-module__Mm8Ika__warn",
  "warnings": "dashboard-module__Mm8Ika__warnings",
});
}),
"[project]/lib/demo.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "demoTimeline",
    ()=>demoTimeline
]);
/* A synthetic run so the dashboard is meaningful with no miner attached.
   Mirrors scripts/miner-ui-demo.py: resume, replay, unknown totals, retries,
   a slow resolution step, and a finish with coverage warnings. */ var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$events$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/events.ts [app-client] (ecmascript)");
;
const SITES = [
    "english.stackexchange.com",
    "math.stackexchange.com",
    "tex.stackexchange.com"
];
const TOTALS = {
    "english.stackexchange.com": 1_180_000,
    "math.stackexchange.com": 4_240_000,
    "tex.stackexchange.com": 1_460_000
};
function demoTimeline() {
    const steps = [];
    const at = (wait, event)=>steps.push({
            wait,
            event
        });
    const checkpoints = __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$events$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["SITE_PHASES"].map((phase)=>({
            site: SITES[0],
            phase,
            ordinal: TOTALS[SITES[0]],
            complete: 1
        }));
    checkpoints.push({
        site: SITES[0],
        phase: "complete",
        ordinal: 0,
        complete: 1
    });
    // The second site resumes mid-collection, so replay has something to show.
    checkpoints.push({
        site: SITES[1],
        phase: "discover_posts",
        ordinal: TOTALS[SITES[1]],
        complete: 1
    });
    checkpoints.push({
        site: SITES[1],
        phase: "discover_comments",
        ordinal: 9_100_000,
        complete: 1
    });
    at(0, {
        event: "run_started",
        release: "synthetic-demo-release",
        manifest: "docs/miner/pilot.manifest.json",
        work_dir: ".miner-work",
        sites: SITES,
        budget_bytes: 10_000_000_000,
        work_bytes: 1_900_000_000,
        checkpoints
    });
    at(200, {
        event: "metrics",
        candidates: 48_100,
        documents: 612_400,
        discovery_hits: 131_900
    });
    const host = SITES[1];
    let newRows = 0;
    let used = 1_900_000_000;
    at(900, {
        event: "site_started",
        site: host
    });
    at(500, {
        event: "inventory",
        site: host,
        tables: [
            "Posts",
            "Comments",
            "PostHistory",
            "PostLinks"
        ],
        missing_optional: []
    });
    const stream = (phase, start, total, ticks, per, unit = "rows", retryAt)=>{
        at(400, {
            event: "stage_started",
            site: host,
            phase,
            resumed_from: start,
            total,
            unit
        });
        if (start) {
            const step = Math.max(1, Math.floor(start / 14));
            for(let replayed = 0; replayed <= start; replayed += step){
                at(110, {
                    event: "replay",
                    site: host,
                    phase,
                    rows: Math.min(replayed, start),
                    target: start
                });
                at(0, {
                    event: "network",
                    requests: 2,
                    bytes: 8_400_000
                });
            }
        }
        let rows = start;
        for(let i = 0; i < ticks; i += 1){
            rows += per;
            newRows += per;
            used += per * 190;
            at(130, {
                event: "progress",
                site: host,
                phase,
                rows,
                committed: rows - 380,
                new_rows: newRows
            });
            if (i % 3 === 0) {
                at(0, {
                    event: "checkpoint",
                    site: host,
                    phase,
                    rows,
                    committed: rows,
                    new_rows: newRows,
                    work_bytes: used
                });
                at(0, {
                    event: "metrics",
                    candidates: 48_100 + Math.floor(newRows / 90),
                    documents: 612_400 + Math.floor(newRows / 7),
                    discovery_hits: 131_900 + Math.floor(newRows / 30)
                });
            }
            if (retryAt !== undefined && i === retryAt) {
                at(0, {
                    event: "retry",
                    url: "https://archive.org/download/stackexchange/math.stackexchange.com.7z",
                    attempt: 2,
                    attempts: 4,
                    delay: 4,
                    status: 503
                });
                at(1100, {
                    event: "working",
                    site: host,
                    phase
                });
            }
            at(0, {
                event: "network",
                requests: 1,
                bytes: 4_100_000
            });
        }
        at(300, {
            event: "stage_complete",
            site: host,
            phase,
            rows,
            total: rows,
            unit,
            new_rows: newRows
        });
    };
    // No denominator yet: an indeterminate bar with real rows and throughput.
    stream("discover_history", 0, null, 20, 41_000, "rows", 8);
    stream("discover_duplicates", 0, null, 8, 12_500);
    at(400, {
        event: "stage_started",
        site: host,
        phase: "resolve_threads",
        total: null,
        unit: "threads"
    });
    for(let i = 0; i < 12; i += 1){
        at(180, {
            event: "working",
            site: host,
            phase: "resolve_threads",
            note: "expanding duplicate groups"
        });
    }
    at(200, {
        event: "stage_complete",
        site: host,
        phase: "resolve_threads",
        rows: 62_880,
        total: 62_880,
        unit: "threads"
    });
    // Resuming collection: replay first, then a total inherited from discovery.
    stream("collect_posts", 1_610_000, TOTALS[host], 18, 96_000);
    at(400, {
        event: "site_complete",
        site: host
    });
    at(700, {
        event: "run_finished",
        status: "complete_with_warnings",
        warnings: {
            comment_count_mismatches: 214,
            orphan_discovery_hits: 0
        },
        message: "Ingestion finished",
        reason: "Coverage is not clean; see warnings."
    });
    return steps;
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/lib/events.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/* The wire vocabulary, mirroring src/se_miner/events.py.
   Any producer that emits these events can drive this dashboard; nothing here
   knows about Stack Exchange, SQLite, or the miner in particular. */ __turbopack_context__.s([
    "CHECKPOINT",
    ()=>CHECKPOINT,
    "COLLECT_SOURCE",
    ()=>COLLECT_SOURCE,
    "INVENTORY",
    ()=>INVENTORY,
    "LOG",
    ()=>LOG,
    "METRICS",
    ()=>METRICS,
    "NETWORK",
    ()=>NETWORK,
    "OPTIONAL_PHASES",
    ()=>OPTIONAL_PHASES,
    "PHASE_LABELS",
    ()=>PHASE_LABELS,
    "PROGRESS",
    ()=>PROGRESS,
    "REPLAY",
    ()=>REPLAY,
    "RETRY",
    ()=>RETRY,
    "RUN_FINISHED",
    ()=>RUN_FINISHED,
    "RUN_STARTED",
    ()=>RUN_STARTED,
    "SITE_COMPLETE",
    ()=>SITE_COMPLETE,
    "SITE_FAILED",
    ()=>SITE_FAILED,
    "SITE_PHASES",
    ()=>SITE_PHASES,
    "SITE_STARTED",
    ()=>SITE_STARTED,
    "SOURCE",
    ()=>SOURCE,
    "STAGE_COMPLETE",
    ()=>STAGE_COMPLETE,
    "STAGE_SKIPPED",
    ()=>STAGE_SKIPPED,
    "STAGE_STARTED",
    ()=>STAGE_STARTED,
    "WORKING",
    ()=>WORKING,
    "phaseLabel",
    ()=>phaseLabel
]);
const SITE_PHASES = [
    "discover_posts",
    "discover_comments",
    "discover_history",
    "discover_duplicates",
    "resolve_threads",
    "collect_posts",
    "collect_comments",
    "collect_history"
];
const OPTIONAL_PHASES = {
    discover_history: "PostHistory",
    discover_duplicates: "PostLinks",
    collect_history: "PostHistory"
};
const COLLECT_SOURCE = {
    collect_posts: "discover_posts",
    collect_comments: "discover_comments",
    collect_history: "discover_history"
};
const PHASE_LABELS = {
    inventory: "Inventorying archive tables",
    discover_posts: "Discovering posts",
    discover_comments: "Scanning comments",
    discover_history: "Scanning post history",
    discover_duplicates: "Mapping duplicate links",
    resolve_threads: "Resolving candidate threads",
    collect_posts: "Collecting full discussions",
    collect_comments: "Collecting thread comments",
    collect_history: "Collecting original revisions",
    complete: "Finalizing site"
};
function phaseLabel(phase) {
    if (phase && PHASE_LABELS[phase]) return PHASE_LABELS[phase];
    if (!phase) return "Working";
    const words = phase.replace(/_/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
}
const RUN_STARTED = "run_started";
const RUN_FINISHED = "run_finished";
const SITE_STARTED = "site_started";
const SITE_COMPLETE = "site_complete";
const SITE_FAILED = "site_failed";
const INVENTORY = "inventory";
const SOURCE = "source";
const NETWORK = "network";
const RETRY = "retry";
const STAGE_STARTED = "stage_started";
const STAGE_SKIPPED = "stage_skipped";
const STAGE_COMPLETE = "stage_complete";
const REPLAY = "replay";
const PROGRESS = "progress";
const CHECKPOINT = "checkpoint";
const WORKING = "working";
const METRICS = "metrics";
const LOG = "log";
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/lib/format.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

/* Decimal units throughout: the miner's budget is expressed in decimal GB. */ __turbopack_context__.s([
    "clockTime",
    ()=>clockTime,
    "compactDuration",
    ()=>compactDuration,
    "humanBytes",
    ()=>humanBytes,
    "humanCount",
    ()=>humanCount,
    "humanDuration",
    ()=>humanDuration,
    "humanRate",
    ()=>humanRate,
    "shortCount",
    ()=>shortCount,
    "tailPath",
    ()=>tailPath
]);
function humanBytes(value) {
    if (value === null || value === undefined) return "—";
    let n = value;
    const units = [
        "B",
        "kB",
        "MB",
        "GB",
        "TB"
    ];
    for(let i = 0; i < units.length; i += 1){
        if (Math.abs(n) < 1000 || i === units.length - 1) {
            return i === 0 ? `${Math.round(n)} B` : `${n.toFixed(1)} ${units[i]}`;
        }
        n /= 1000;
    }
    return `${n} B`;
}
function humanCount(value) {
    if (value === null || value === undefined) return "—";
    return Math.round(value).toLocaleString("en-US");
}
function shortCount(value) {
    if (value === null || value === undefined) return "—";
    const n = Math.round(value);
    if (Math.abs(n) < 10_000) return n.toLocaleString("en-US");
    if (Math.abs(n) < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0)}k`;
    if (Math.abs(n) < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    return `${(n / 1_000_000_000).toFixed(1)}B`;
}
function humanDuration(seconds) {
    if (seconds === null || seconds === undefined) return "—";
    const total = Math.max(0, Math.floor(seconds));
    const days = Math.floor(total / 86400);
    const h = Math.floor(total % 86400 / 3600);
    const m = Math.floor(total % 3600 / 60);
    const s = total % 60;
    const pad = (v)=>String(v).padStart(2, "0");
    const stamp = `${pad(h)}:${pad(m)}:${pad(s)}`;
    return days ? `${days}d ${stamp}` : stamp;
}
function humanRate(rate, unit = "rows") {
    if (!rate) return `— ${unit}/s`;
    if (rate >= 1000) return `${shortCount(rate)} ${unit}/s`;
    return `${rate.toFixed(1)} ${unit}/s`;
}
function compactDuration(seconds) {
    if (seconds === null || seconds === undefined) return "—";
    const total = Math.max(0, Math.round(seconds));
    if (total < 1) return "<1s";
    if (total < 60) return `${total}s`;
    const minutes = Math.floor(total / 60);
    const restSeconds = total % 60;
    if (minutes < 60) return restSeconds ? `${minutes}m ${restSeconds}s` : `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;
    if (hours < 24) return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
function clockTime(wallSeconds) {
    const d = new Date(wallSeconds * 1000);
    const pad = (v)=>String(v).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function tailPath(value, max = 40) {
    if (!value) return "";
    if (value.length <= max) return value;
    const base = value.split("/").pop() ?? value;
    return base.length <= max ? base : `…${base.slice(-(max - 1))}`;
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/lib/source.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "resolveFeedUrl",
    ()=>resolveFeedUrl,
    "useRunFeed",
    ()=>useRunFeed
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$build$2f$polyfills$2f$process$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = /*#__PURE__*/ __turbopack_context__.i("[project]/node_modules/next/dist/build/polyfills/process.js [app-client] (ecmascript)");
/* Feeds the model and paces re-renders.

   Events can arrive thousands per second, so nothing here re-renders per event:
   the model accumulates, and a bounded tick publishes a snapshot — the same
   contract the terminal dashboard uses. */ var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$demo$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/demo.ts [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$state$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/state.ts [app-client] (ecmascript)");
var _s = __turbopack_context__.k.signature();
"use client";
;
;
;
const FRAME_MS = 100;
function resolveFeedUrl() {
    if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
    ;
    const override = new URLSearchParams(window.location.search).get("events");
    if (override) return override;
    const configured = __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$build$2f$polyfills$2f$process$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"].env.NEXT_PUBLIC_MINER_EVENTS;
    if (configured) return configured;
    // A dev server on another port cannot serve the stream itself.
    if (window.location.port && window.location.port !== "8787") {
        return `${window.location.protocol}//${window.location.hostname}:8787/events`;
    }
    return "/events";
}
function useRunFeed(mode) {
    _s();
    const model = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useMemo"])({
        "useRunFeed.useMemo[model]": ()=>new __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$state$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["RunModel"]()
    }["useRunFeed.useMemo[model]"], []);
    const [snapshot, setSnapshot] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])({
        "useRunFeed.useState": ()=>model.snapshot()
    }["useRunFeed.useState"]);
    const [connection, setConnection] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(mode === "demo" ? "demo" : "connecting");
    const [epoch, setEpoch] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(0);
    const seen = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(-1);
    const restart = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useCallback"])({
        "useRunFeed.useCallback[restart]": ()=>{
            model.reset();
            seen.current = -1;
            setEpoch({
                "useRunFeed.useCallback[restart]": (n)=>n + 1
            }["useRunFeed.useCallback[restart]"]);
        }
    }["useRunFeed.useCallback[restart]"], [
        model
    ]);
    // Publish at a bounded rate. While a run is live the elapsed clock moves on
    // its own, so a tick with no new events still needs to paint.
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "useRunFeed.useEffect": ()=>{
            let frame = 0;
            const id = window.setInterval({
                "useRunFeed.useEffect.id": ()=>{
                    const live = model.version !== seen.current;
                    const running = model.runStatus === "starting" || model.runStatus === "running";
                    if (!live && !running && frame > 0) return;
                    seen.current = model.version;
                    frame += 1;
                    setSnapshot(model.snapshot());
                }
            }["useRunFeed.useEffect.id"], FRAME_MS);
            return ({
                "useRunFeed.useEffect": ()=>window.clearInterval(id)
            })["useRunFeed.useEffect"];
        }
    }["useRunFeed.useEffect"], [
        model
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "useRunFeed.useEffect": ()=>{
            if (mode !== "demo") return undefined;
            const steps = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$demo$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["demoTimeline"])();
            let index = 0;
            let timer = 0;
            const play = {
                "useRunFeed.useEffect.play": ()=>{
                    if (index >= steps.length) return;
                    const step = steps[index];
                    index += 1;
                    model.apply(step.event);
                    const next = steps[index];
                    timer = window.setTimeout(play, next ? next.wait : 0);
                }
            }["useRunFeed.useEffect.play"];
            timer = window.setTimeout(play, steps[0]?.wait ?? 0);
            return ({
                "useRunFeed.useEffect": ()=>window.clearTimeout(timer)
            })["useRunFeed.useEffect"];
        }
    }["useRunFeed.useEffect"], [
        mode,
        model,
        epoch
    ]);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "useRunFeed.useEffect": ()=>{
            if (mode !== "live") return undefined;
            if (("TURBOPACK compile-time value", "object") === "undefined" || typeof EventSource === "undefined") return undefined;
            setConnection("connecting");
            const source = new EventSource(resolveFeedUrl());
            source.onopen = ({
                "useRunFeed.useEffect": ()=>setConnection("open")
            })["useRunFeed.useEffect"];
            source.onmessage = ({
                "useRunFeed.useEffect": (message)=>{
                    for (const line of String(message.data).split("\n")){
                        if (!line.trim()) continue;
                        try {
                            model.apply(JSON.parse(line));
                        } catch  {
                        /* a partial or non-JSON line is data, not a reason to stop */ }
                    }
                }
            })["useRunFeed.useEffect"];
            source.addEventListener("done", {
                "useRunFeed.useEffect": ()=>{
                    setConnection("closed");
                    source.close();
                }
            }["useRunFeed.useEffect"]);
            source.onerror = ({
                "useRunFeed.useEffect": ()=>setConnection({
                        "useRunFeed.useEffect": (c)=>c === "open" ? "error" : "connecting"
                    }["useRunFeed.useEffect"])
            })["useRunFeed.useEffect"];
            return ({
                "useRunFeed.useEffect": ()=>source.close()
            })["useRunFeed.useEffect"];
        }
    }["useRunFeed.useEffect"], [
        mode,
        model,
        epoch
    ]);
    return {
        snapshot,
        connection,
        restart
    };
}
_s(useRunFeed, "NgKrBpLN+Y2JpBIDZcIY6FMIndk=");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/lib/state.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "RunModel",
    ()=>RunModel
]);
/* Presentation model for one pipeline run, mirroring src/se_miner/uistate.py.

   Mutable accumulator plus an immutable snapshot: events can arrive thousands
   per second, so React re-renders are driven by a bounded tick that reads
   `snapshot()`, never by the event stream itself. */ var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$events$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/events.ts [app-client] (ecmascript)");
;
const DONE = new Set([
    "complete",
    "skipped"
]);
const MAX_LOG = 400;
const RATE_WINDOW = 6;
const CHECKPOINT_LOG_INTERVAL = 15;
function push(samples, t, v) {
    samples.push({
        t,
        v
    });
    if (samples.length > 64) samples.shift();
}
function rateOf(samples, now) {
    const points = samples.filter((s)=>now - s.t <= RATE_WINDOW);
    if (points.length < 2) return null;
    const span = points[points.length - 1].t - points[0].t;
    const delta = points[points.length - 1].v - points[0].v;
    if (span < 0.25 || delta < 0) return null;
    return delta / span;
}
class RunModel {
    /** Bumped on every applied event so a view can skip identical frames. */ version = 0;
    started = this.now();
    finished = null;
    lastEvent = this.now();
    logSeq = 0;
    /** Producer clock, when the stream carries one: a backlog replayed in a
      second still reports the hours the run really took. */ stamp = null;
    startedWall = null;
    finishedWall = null;
    release = null;
    manifest = null;
    workDir = null;
    status = "starting";
    reason = null;
    warnings = {};
    resumed = false;
    rowsThisRun = 0;
    activeKey = null;
    order = [];
    sites = new Map();
    log = [];
    metrics = {
        candidates: 0,
        documents: 0,
        discoveryHits: 0
    };
    storage = {
        used: null,
        limit: null
    };
    network = {
        requests: 0,
        bytes: 0,
        last: null,
        note: null
    };
    /** Cheap enough to poll every frame, unlike building a whole snapshot. */ get runStatus() {
        return this.status;
    }
    now() {
        return (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
    }
    wall() {
        return Date.now() / 1000;
    }
    reset() {
        this.started = this.now();
        this.finished = null;
        this.stamp = null;
        this.startedWall = null;
        this.finishedWall = null;
        this.status = "starting";
        this.release = this.manifest = this.workDir = this.reason = null;
        this.warnings = {};
        this.resumed = false;
        this.rowsThisRun = 0;
        this.activeKey = null;
        this.order = [];
        this.sites = new Map();
        this.log = [];
        this.metrics = {
            candidates: 0,
            documents: 0,
            discoveryHits: 0
        };
        this.storage = {
            used: null,
            limit: null
        };
        this.network = {
            requests: 0,
            bytes: 0,
            last: null,
            note: null
        };
        this.version += 1;
    }
    addLog(level, text) {
        this.logSeq += 1;
        this.log.push({
            id: this.logSeq,
            at: this.stamp ?? this.wall(),
            level,
            text
        });
        if (this.log.length > MAX_LOG) this.log.shift();
    }
    site(host) {
        let site = this.sites.get(host);
        if (!site) {
            site = {
                site: host,
                status: "pending",
                tables: null,
                missingOptional: [],
                planned: [
                    ...__TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$events$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["SITE_PHASES"]
                ],
                stages: new Map(),
                started: null,
                note: null
            };
            this.sites.set(host, site);
            this.order.push(host);
        }
        return site;
    }
    stage(host, phase) {
        const site = this.site(host);
        let stage = site.stages.get(phase);
        if (!stage) {
            stage = {
                phase,
                label: (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$events$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["phaseLabel"])(phase),
                status: "pending",
                observed: 0,
                committed: 0,
                total: null,
                unit: "rows",
                resumedFrom: 0,
                replayed: 0,
                replayTarget: 0,
                replaying: false,
                note: null,
                started: null,
                committedAt: null,
                loggedAt: 0,
                samples: [],
                replaySamples: []
            };
            site.stages.set(phase, stage);
        }
        return stage;
    }
    /** A finished discovery pass is the denominator for its collection pass. */ refreshTotals(site) {
        for (const [phase, source] of Object.entries(__TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$events$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["COLLECT_SOURCE"])){
            const origin = site.stages.get(source);
            if (!origin || origin.status !== "complete" || origin.total === null) continue;
            if (!site.planned.includes(phase)) continue;
            const stage = this.stage(site.site, phase);
            if (stage.total === null && stage.status !== "complete") stage.total = origin.total;
        }
    }
    apply(ev) {
        if (!ev || typeof ev !== "object") return;
        this.stamp = typeof ev.at === "number" ? ev.at : null;
        const kind = ev.event;
        if (kind) this.dispatch(kind, ev);
        else if (ev.phase) this.dispatch(ev.complete ? "stage_complete" : "progress", ev);
        this.lastEvent = this.now();
        this.version += 1;
    }
    dispatch(kind, ev) {
        switch(kind){
            case "run_started":
                return this.onRunStarted(ev);
            case "site_started":
                return this.onSiteStarted(ev);
            case "inventory":
                return this.onInventory(ev);
            case "stage_started":
                return this.onStageStarted(ev);
            case "stage_skipped":
                return this.onStageSkipped(ev);
            case "replay":
                return this.onReplay(ev);
            case "progress":
                return this.onProgress(ev);
            case "checkpoint":
                return this.onCheckpoint(ev);
            case "working":
                return this.onWorking(ev);
            case "stage_complete":
                return this.onStageComplete(ev);
            case "site_complete":
                return this.onSiteComplete(ev);
            case "site_failed":
                return this.onSiteFailed(ev);
            case "source":
                return this.onSource(ev);
            case "network":
                return this.onNetwork(ev);
            case "retry":
                return this.onRetry(ev);
            case "metrics":
                return this.onMetrics(ev);
            case "log":
                return this.onLog(ev);
            case "run_finished":
                return this.onRunFinished(ev);
            default:
                return undefined;
        }
    }
    onRunStarted(ev) {
        // A feed may carry several runs back to back; each one starts clean.
        const stamp = this.stamp;
        this.reset();
        this.stamp = stamp;
        this.startedWall = stamp;
        this.release = ev.release ?? null;
        this.manifest = ev.manifest ?? null;
        this.workDir = ev.work_dir ?? null;
        this.storage.limit = ev.budget_bytes ?? null;
        if (ev.work_bytes !== undefined) this.storage.used = ev.work_bytes;
        for (const host of ev.sites ?? [])this.site(host);
        for (const row of ev.checkpoints ?? []){
            const host = row.site;
            if (!host || !this.sites.has(host)) continue;
            if (row.phase === "complete") {
                if (row.complete) this.site(host).status = "complete";
                continue;
            }
            if (!__TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$events$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["SITE_PHASES"].includes(row.phase)) continue;
            const stage = this.stage(host, row.phase);
            stage.observed = stage.committed = stage.resumedFrom = row.ordinal ?? 0;
            if (row.complete) {
                stage.status = "complete";
                stage.total = stage.observed;
                stage.note = "completed in an earlier run";
                this.resumed = true;
            } else if (stage.observed) {
                this.resumed = true;
            }
        }
        for (const site of this.sites.values())this.refreshTotals(site);
        this.status = "running";
        this.addLog("info", this.resumed ? `Resuming ${this.release ?? "run"} from saved checkpoints` : `Starting ${this.release ?? "run"}`);
    }
    onSiteStarted(ev) {
        const site = this.site(ev.site);
        site.started = this.now();
        if (site.status !== "complete") site.status = "active";
        this.addLog("info", site.site);
    }
    onInventory(ev) {
        const site = this.site(ev.site);
        site.tables = [
            ...ev.tables ?? []
        ];
        site.missingOptional = [
            ...ev.missing_optional ?? []
        ];
        site.planned = __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$events$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["SITE_PHASES"].filter((p)=>{
            const table = __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$events$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["OPTIONAL_PHASES"][p];
            return !table || !site.missingOptional.includes(table);
        });
        this.refreshTotals(site);
        this.addLog("info", `${site.site} tables: ${site.tables.join(", ") || "none"}`);
        if (site.missingOptional.length) {
            this.addLog("warn", `${site.site} has no ${site.missingOptional.join(", ")}`);
        }
    }
    onStageStarted(ev) {
        const stage = this.stage(ev.site, ev.phase);
        stage.status = "active";
        stage.started = this.now();
        stage.resumedFrom = ev.resumed_from ?? 0;
        stage.observed = stage.committed = stage.resumedFrom;
        if (ev.total !== undefined && ev.total !== null) stage.total = ev.total;
        if (ev.unit) stage.unit = ev.unit;
        stage.replayTarget = stage.resumedFrom;
        stage.replaying = Boolean(stage.resumedFrom);
        stage.samples = [];
        stage.replaySamples = [];
        this.network.note = null;
        this.activeKey = [
            ev.site,
            ev.phase
        ];
        this.addLog("info", stage.resumedFrom ? `${stage.label} — resuming after row ${stage.resumedFrom.toLocaleString("en-US")}` : stage.label);
    }
    onStageSkipped(ev) {
        const stage = this.stage(ev.site, ev.phase);
        const reason = ev.reason ?? "skipped";
        if (reason === "already complete") {
            stage.status = "complete";
            stage.note = "completed in an earlier run";
            stage.observed = stage.committed = ev.rows ?? stage.observed;
            stage.total = stage.observed;
            this.refreshTotals(this.site(ev.site));
            this.addLog("info", `${stage.label} already complete`);
        } else {
            stage.status = "skipped";
            stage.note = reason;
            this.addLog("info", `${stage.label} skipped — ${reason}`);
        }
    }
    onReplay(ev) {
        const stage = this.stage(ev.site, ev.phase);
        stage.replaying = true;
        stage.replayed = ev.rows ?? 0;
        if (ev.target) stage.replayTarget = ev.target;
        push(stage.replaySamples, this.now(), stage.replayed);
        this.activeKey = [
            ev.site,
            ev.phase
        ];
    }
    onProgress(ev) {
        const stage = this.stage(ev.site, ev.phase);
        stage.status = "active";
        stage.replaying = false;
        stage.observed = ev.rows ?? 0;
        if (ev.committed !== undefined) stage.committed = ev.committed;
        if (ev.total !== undefined && ev.total !== null) stage.total = ev.total;
        if (ev.new_rows !== undefined) this.rowsThisRun = ev.new_rows;
        if (ev.work_bytes !== undefined) this.storage.used = ev.work_bytes;
        push(stage.samples, this.now(), stage.observed);
        this.activeKey = [
            ev.site,
            ev.phase
        ];
    }
    onCheckpoint(ev) {
        this.onProgress(ev);
        const stage = this.stage(ev.site, ev.phase);
        stage.committed = ev.committed ?? ev.rows ?? 0;
        stage.committedAt = this.stamp ?? this.wall();
        const now = this.now();
        // The live readout already shows the committed ordinal; the log only needs
        // a periodic anchor, not a line per batch.
        if (now - stage.loggedAt >= CHECKPOINT_LOG_INTERVAL) {
            stage.loggedAt = now;
            this.addLog("info", `Checkpoint at row ${stage.committed.toLocaleString("en-US")}`);
        }
    }
    onWorking(ev) {
        const stage = this.stage(ev.site, ev.phase);
        stage.status = "active";
        if (ev.note) stage.note = ev.note;
        this.activeKey = [
            ev.site,
            ev.phase
        ];
    }
    onStageComplete(ev) {
        const stage = this.stage(ev.site, ev.phase);
        const rows = ev.rows ?? 0;
        stage.status = "complete";
        stage.observed = stage.committed = rows;
        stage.total = ev.total ?? rows;
        if (ev.unit) stage.unit = ev.unit;
        stage.replaying = false;
        stage.committedAt = this.stamp ?? this.wall();
        this.network.note = null;
        if (ev.new_rows !== undefined) this.rowsThisRun = ev.new_rows;
        this.refreshTotals(this.site(ev.site));
        this.addLog("info", `${stage.label} — ${rows.toLocaleString("en-US")} ${stage.unit}`);
    }
    onSiteComplete(ev) {
        this.site(ev.site).status = "complete";
        this.addLog("info", `Finished ${ev.site}`);
    }
    onSiteFailed(ev) {
        const site = this.site(ev.site);
        site.status = "failed";
        site.note = ev.message ?? null;
        this.addLog("error", `${ev.site} failed — ${ev.message ?? "unknown error"}`);
    }
    onSource(ev) {
        const note = ev.note ?? ev.action ?? null;
        this.network.note = note;
        if (ev.quiet) return;
        const short = ev.url ? String(ev.url).split("/").pop() : "";
        this.addLog("info", short ? `${note} ${short}` : String(note));
    }
    onNetwork(ev) {
        this.network.requests += ev.requests ?? 0;
        this.network.bytes += ev.bytes ?? 0;
        this.network.last = this.now();
        // Traffic moving again means any "retrying" note is stale.
        this.network.note = ev.note ?? null;
    }
    onRetry(ev) {
        const detail = ev.status ? `HTTP ${ev.status}` : ev.error ?? "no response";
        this.network.note = `retrying in ${ev.delay}s`;
        this.addLog("warn", `Retry ${ev.attempt}/${ev.attempts} after ${detail} — waiting ${ev.delay}s`);
    }
    onMetrics(ev) {
        if (ev.candidates !== undefined) this.metrics.candidates = ev.candidates;
        if (ev.documents !== undefined) this.metrics.documents = ev.documents;
        if (ev.discovery_hits !== undefined) this.metrics.discoveryHits = ev.discovery_hits;
        if (ev.work_bytes !== undefined) this.storage.used = ev.work_bytes;
        if (ev.budget_bytes !== undefined) this.storage.limit = ev.budget_bytes;
    }
    onLog(ev) {
        this.addLog(ev.level ?? "info", ev.message ?? "");
    }
    onRunFinished(ev) {
        this.status = ev.status ?? "complete";
        this.finished = this.now();
        this.finishedWall = this.stamp;
        this.reason = ev.reason ?? null;
        this.warnings = ev.warnings ?? {};
        const level = this.status === "failed" ? "error" : this.status === "paused" ? "warn" : "info";
        this.addLog(level, ev.message ?? this.status);
    }
    stageView(stage, now) {
        const view = {
            phase: stage.phase,
            label: stage.label,
            status: stage.status,
            observed: stage.observed,
            committed: stage.committed,
            total: stage.total,
            unit: stage.unit,
            resumedFrom: stage.resumedFrom,
            replayed: stage.replayed,
            replayTarget: stage.replayTarget,
            replaying: stage.replaying,
            note: stage.note,
            committedAt: stage.committedAt,
            elapsed: stage.started ? now - stage.started : 0,
            newRows: Math.max(0, stage.observed - stage.resumedFrom),
            rate: rateOf(stage.samples, now),
            replayRate: rateOf(stage.replaySamples, now),
            percent: null,
            eta: null
        };
        if (stage.replaying) {
            // Replay has a real denominator: the committed ordinal being replayed to.
            if (stage.replayTarget) view.percent = Math.min(1, stage.replayed / stage.replayTarget);
            if (view.replayRate) {
                view.eta = Math.max(0, (stage.replayTarget - stage.replayed) / view.replayRate);
            }
        } else if (stage.total) {
            view.percent = Math.min(1, stage.observed / stage.total);
            if (view.rate && stage.status === "active") {
                view.eta = Math.max(0, (stage.total - stage.observed) / view.rate);
            }
        }
        return view;
    }
    /** Prefer the producer's own clock; fall back to how long we have watched. */ elapsed(now) {
        if (this.startedWall !== null) {
            return Math.max(0, (this.finishedWall ?? this.wall()) - this.startedWall);
        }
        return (this.finished ?? now) - this.started;
    }
    snapshot() {
        const now = this.now();
        const sites = [];
        let doneStages = 0;
        let totalStages = 0;
        let doneSites = 0;
        for (const host of this.order){
            const site = this.sites.get(host);
            const phases = site.planned.map((phase)=>{
                const stage = site.stages.get(phase);
                return {
                    phase,
                    label: (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$events$2e$ts__$5b$app$2d$client$5d$__$28$ecmascript$29$__["phaseLabel"])(phase),
                    status: stage?.status ?? "pending"
                };
            });
            const finished = phases.filter((p)=>DONE.has(p.status)).length;
            doneStages += finished;
            totalStages += phases.length;
            if (site.status === "complete") doneSites += 1;
            const current = site.planned.map((p)=>site.stages.get(p)).find((s)=>s?.status === "active");
            sites.push({
                site: host,
                status: site.status,
                done: finished,
                planned: phases.length,
                phases,
                missingOptional: [
                    ...site.missingOptional
                ],
                note: site.note,
                stage: current?.label ?? null
            });
        }
        let active = null;
        if (this.activeKey) {
            const [host, phase] = this.activeKey;
            const stage = this.sites.get(host)?.stages.get(phase);
            if (stage) active = {
                site: host,
                ...this.stageView(stage, now)
            };
        }
        return {
            release: this.release,
            manifest: this.manifest,
            workDir: this.workDir,
            status: this.status,
            elapsed: this.elapsed(now),
            reason: this.reason,
            warnings: {
                ...this.warnings
            },
            resumed: this.resumed,
            rowsThisRun: this.rowsThisRun,
            sites,
            active,
            overall: {
                stages: doneStages,
                stagesTotal: totalStages,
                sites: doneSites,
                sitesTotal: this.order.length
            },
            metrics: {
                ...this.metrics
            },
            storage: {
                ...this.storage
            },
            network: {
                ...this.network
            },
            idle: now - this.lastEvent,
            log: this.log.slice()
        };
    }
}
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
"[project]/lib/tone.ts [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "RUN_LABEL",
    ()=>RUN_LABEL,
    "runTone",
    ()=>runTone,
    "siteTone",
    ()=>siteTone,
    "toneVars",
    ()=>toneVars
]);
const CLASS = {
    ok: "2",
    info: "3",
    warn: "4",
    err: "5"
};
function toneVars(tone) {
    if (tone === "mute") {
        return {
            "--k": "var(--ink-3)",
            "--k-soft": "var(--surface)",
            "--k-line": "var(--line-2)"
        };
    }
    const n = CLASS[tone];
    return {
        "--k": `var(--c${n})`,
        "--k-soft": `var(--c${n}-soft)`,
        "--k-line": `var(--c${n}-line)`
    };
}
function runTone(status) {
    switch(status){
        case "complete":
            return "ok";
        case "complete_with_warnings":
        case "paused":
        case "incomplete":
            return "warn";
        case "failed":
            return "err";
        default:
            return "info";
    }
}
function siteTone(status) {
    switch(status){
        case "complete":
            return "ok";
        case "active":
            return "info";
        case "failed":
            return "err";
        default:
            return "mute";
    }
}
const RUN_LABEL = {
    starting: "starting",
    running: "running",
    paused: "paused",
    complete: "complete",
    complete_with_warnings: "warnings",
    incomplete: "incomplete",
    failed: "failed"
};
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
]);

//# sourceMappingURL=_0qluazp._.js.map