# Evaluation implementation environment

Inspected October 27, 2026. Project Node requirement: >=22.13 <23, npm >=10 <11; Zod 4.6.7 unchanged. Host initially Node 24.19.0/npm 11.9.0; subsequent verification uses Node 22.13.1/npm 10.9.2 downloaded to /tmp through npm exec. No credentials configured; no Gemini/LangSmith calls made.

Official docs read before implementation:

- [Install/overview](https://docs.langchain.com/oss/javascript/langchain/install): packages are modular; use only core, without agent harness.
- [Google integration](https://docs.langchain.com/oss/javascript/integrations/chat/google): current recommended integration is @langchain/google; older google-genai is deprecated. We retain Scoot's bounded REST transport inside RunnableLambda to preserve its existing schema/config, finish-reason handling, byte limits and no-retry behavior. No Google SDK dependency is needed.
- [Models](https://docs.langchain.com/oss/javascript/langchain/models) and [structured output](https://docs.langchain.com/oss/javascript/langchain/structured-output): keep existing JSON schemas and own Zod/semantic checks; no model-generated calculations or structured-output retry helper.
- [RunnableLambda/composition](https://reference.langchain.com/javascript/langchain-core/runnables/RunnableLambda), [AbortSignal](https://reference.langchain.com/javascript/langchain-core/language_models/base/BaseLanguageModelCallOptions), [callbacks](https://reference.langchain.com/javascript/langchain-core/callbacks/manager/BaseCallbackConfig): named steps and one shared abort budget; avoid withRetry. The model docs describe automatic retries; our existing transport has none.
- [FakeListChatModel](https://reference.langchain.com/javascript/classes/_langchain_core.utils_testing.FakeListChatModel.html), [testing](https://docs.langchain.com/oss/javascript/langchain/test): deterministic fake chat responses in tests and evaluation. Installed declaration/source is also checked for the exact API.
- [LangGraph](https://docs.langchain.com/oss/javascript/langgraph/overview): durable stateful orchestration is unnecessary for two bounded calls.
- [LangSmith tracing](https://docs.langchain.com/langsmith/trace-with-langchain), [privacy](https://docs.langchain.com/langsmith/mask-inputs-outputs): LANGSMITH_TRACING, LANGSMITH_API_KEY, LANGSMITH_ENDPOINT, LANGSMITH_PROJECT (compatibility project), LANGSMITH_WORKSPACE_ID; hide inputs/outputs. Server tracing must be disabled even with inherited tracing environment variables; only the synthetic evaluation process may opt in explicitly. Token counts come only from provider usage metadata, never estimated.

Registry metadata checked explicitly: @langchain/core 1.3.0 supports Node >=20 and Zod ^3.25.76 || ^4; compatible with Node 22 and existing Zod 4.6.7. LangSmith 0.11.1 is within core's >=0.11.0 <1.0.0 dependency range. Exact installed versions and transitive resolution are recorded in package-lock.json.

Optional LangSmith spans are exported retrospectively from the finished evaluation metrics. The trace service span duration measures export execution, not model latency; use the attached step durationMs and evaluation wallDurationMs tables for latency. Inputs/outputs are hidden, and no prompts or model output are sent even for fictional cases.
