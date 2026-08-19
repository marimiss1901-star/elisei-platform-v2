ELISEI OWNER RECOVERY HOTFIX

1. Upload this patch over current ELISEI 5.12.0 with replacement.
2. Redeploy backend only.
3. Open ELISEI -> Forgot password -> enter the email you tried before.
4. Open Render backend logs.
5. If the database contains exactly one account, the logs will contain an [ELISEI PASSWORD RESET] owner recovery link valid for 15 minutes.
6. If there are multiple accounts, the logs will show masked email hints only; enter the correct email and request the link again.

Security: no registered email or reset token is returned to the public browser. The recovery link is written only to private backend logs.
