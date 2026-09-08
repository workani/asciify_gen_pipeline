// Single source of truth for the fixed "100" smoke cohort. Both `test.sh --100`
// (isolated DB, throwaway) and `generator run|tui --100` (main DB, checkpointed
// and resumable) must exercise the exact same characters, so the charset lives
// here instead of being duplicated in the shell script.
const LATEST_CPS = "27bb,27a6,21af,2022,2003,2014,229e,1f972,261e,1f64f,2661,1f494,250c,256c,2260,2297";
const OLD_CPS = "1faac,1f9ff,2660,2666,2696,2318,203b,2e2e,2299";
// 75 additions: arrows (10), typography/spacing (15), mathematics (15),
// shapes (10), currency/UI symbols (10), and everyday emoji (15).
const EXTRA_CPS = [
  "2190,2191,2192,2193,2194,2195,21a9,21aa,21ba,21bb",
  "a0,ad,2009,200b,200d,2013,2018,2019,201c,201d,2026,b7,a7,b6,2020",
  "b1,d7,f7,2212,221a,221e,2248,2264,2265,2211,220f,222b,2205,2208,2229",
  "25a0,25a1,25b2,25bc,25b6,25c0,25cf,25cb,2605,2606",
  "a9,ae,2122,20ac,a3,a5,2713,2717,26a0,23ce",
  "2764,1f600,1f602,1f60d,1f622,1f44d,1f44e,1f44f,1f4aa,1f525,2728,1f389,1f4a1,1f512,1f680",
].join(",");

export const HUNDRED_COHORT_HEX = `${LATEST_CPS},${OLD_CPS},${EXTRA_CPS}`;
export const HUNDRED_COHORT_CPS = HUNDRED_COHORT_HEX.split(",").map((value) => Number.parseInt(value, 16));
