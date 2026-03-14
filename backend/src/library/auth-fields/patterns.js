export const USERNAME_HINT_PATTERN_SOURCE =
  "\\b(email|e-mail|username|user name|user|login|identifier|account|phone|mobile|access key|account id|employee id|user id|member id|workspace id|tenant id|organization id|organisation id|customer id|login id|sign[-\\s]?in id|handle|short code|portal key|staff id|staff portal key)\\b";

export const PASSWORD_HINT_PATTERN_SOURCE = "\\b(password|passcode|pass phrase|secret|pin)\\b";
export const OTP_HINT_PATTERN_SOURCE =
  "\\b(otp|verification|verify|code|2fa|two[-\\s]?factor|one[-\\s]?time|security code)\\b";
export const SEARCH_HINT_PATTERN_SOURCE = "\\b(search|query|find)\\b";

export const NEXT_CONTROL_PATTERN_SOURCE = "\\b(next|continue|proceed|continue with|use account|go on)\\b";
export const SUBMIT_CONTROL_PATTERN_SOURCE =
  "\\b(sign in|log in|login|submit|verify|confirm|allow|continue|continue with account|use account)\\b";

export const USERNAME_HINT_RE = new RegExp(USERNAME_HINT_PATTERN_SOURCE, "i");
export const PASSWORD_HINT_RE = new RegExp(PASSWORD_HINT_PATTERN_SOURCE, "i");
export const OTP_HINT_RE = new RegExp(OTP_HINT_PATTERN_SOURCE, "i");
export const SEARCH_HINT_RE = new RegExp(SEARCH_HINT_PATTERN_SOURCE, "i");
export const NEXT_CONTROL_RE = new RegExp(NEXT_CONTROL_PATTERN_SOURCE, "i");
export const SUBMIT_CONTROL_RE = new RegExp(SUBMIT_CONTROL_PATTERN_SOURCE, "i");

export const IDENTIFIER_FIELD_PATTERN = new RegExp(USERNAME_HINT_PATTERN_SOURCE, "i");
export const PASSWORD_FIELD_PATTERN = new RegExp(PASSWORD_HINT_PATTERN_SOURCE, "i");
export const AUTH_SUBMIT_CONTROL_PATTERN = new RegExp(SUBMIT_CONTROL_PATTERN_SOURCE, "i");

export const FIRST_CREDENTIAL_KEYS = Object.freeze([
  "identifier",
  "accessKey",
  "access_key",
  "username",
  "email",
  "loginId",
  "login_id",
  "accountId",
  "account_id",
  "userId",
  "user_id"
]);

export const AUTH_FIELD_QUERY_SELECTOR = "input, textarea";
export const AUTH_CONTROL_QUERY_SELECTOR = [
  "button",
  "input[type='submit']",
  "input[type='button']",
  "[role='button']",
  "a[role='button']",
  "a[href]",
  "div[role='button']",
  "span[role='button']",
  "div[onclick]",
  "span[onclick]",
  "[tabindex]"
].join(",");

export const USERNAME_SELECTOR = [
  "input[autocomplete='email']",
  "input[type='email']",
  "input[autocomplete='username']",
  "input[name*='email' i]",
  "input[id*='email' i]",
  "input[name*='user' i]",
  "input[id*='user' i]",
  "input[name*='login' i]"
].join(",");

export const PASSWORD_SELECTOR = "input[type='password'], input[autocomplete='current-password']";

export const OTP_SELECTOR = [
  "input[autocomplete='one-time-code']",
  "input[inputmode='numeric'][name*='code' i]",
  "input[name*='otp' i]",
  "input[id*='otp' i]",
  "input[name*='code' i]",
  "input[id*='code' i]",
  "input[name*='verification' i]",
  "input[id*='verification' i]"
].join(",");

export const SUBMIT_SELECTOR = [
  "button[type='submit']",
  "input[type='submit']",
  "[role='button'][aria-label*='submit' i]",
  "button[aria-label*='sign in' i]",
  "button[aria-label*='log in' i]",
  "button[aria-label*='verify' i]",
  "button[aria-label*='continue' i]",
  "button[aria-label*='next' i]",
  "[role='button'][aria-label*='continue' i]",
  "a[role='button'][aria-label*='continue' i]",
  "a[role='button'][aria-label*='next' i]"
].join(",");
