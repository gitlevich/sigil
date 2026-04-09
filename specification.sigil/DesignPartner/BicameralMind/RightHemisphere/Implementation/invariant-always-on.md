# always-on

The @EmbeddingModel and @LocalLLM are loaded when the app starts and remain responsive until it closes. No cold start, no warm-up delay. The @RightHemisphere is attending from the moment the app opens.

Violation: the @user edits for some period before the local models finish loading. Changes during that window go unattended.
