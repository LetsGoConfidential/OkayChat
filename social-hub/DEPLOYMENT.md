# OkayChat profile hub deployment

The canonical funnel page is the public Next.js route `/connect` in `apps/web/app/connect`. It is excluded from the sign-in gate and links to the currently verified Instagram, Threads, LinkedIn, Facebook and YouTube profiles, plus WhatsApp and email contact actions.

## Publish steps

1. Deploy the OkayChat web app using the project's normal hosting workflow.
2. Configure the `okaychat.in` domain and HTTPS to point to that web deployment. The domain did not resolve during the social-profile audit, so do not add it to public bios until DNS and the secure page are live.
3. Verify `https://okaychat.in/connect` on desktop and mobile, and check that each external profile link opens the intended OkayChat account.
4. Add the same URL to Instagram, Facebook, Threads, LinkedIn, YouTube and X after the X account is created. Keep the platform's primary contact button pointed to the customer-support WhatsApp line or email.

`index.html` is a standalone static fallback with the same content. Use it only if the deployment is static and does not serve the Next.js route.
