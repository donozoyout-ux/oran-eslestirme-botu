import { installGoogleOauthGrantTypeFix } from "./google-oauth-compat.js";

installGoogleOauthGrantTypeFix();
await import("./index.js");
