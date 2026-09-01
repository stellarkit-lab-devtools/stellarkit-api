# TODO

## Error Handling Enrichment | Add a specific error for insufficient XLM reserve
- [x] Step 1: Add `makeInsufficientXLMReserveError()` to `src/utils/errors.js`
- [x] Step 2: Update `src/middleware/errorHandler.js` to handle `isInsufficientXLMReserve`
- [x] Step 3: Add tests in `tests/errorHandler.test.js`
- [x] Step 4: Run tests to verify

## Response Normalisation | Normalise GET /account/:id/sequence response shape
- [ ] Analyse expected vs actual response shapes
- [ ] Implement normalization changes
- [ ] Run tests to verify

## Cache bypass documentation (?fresh=true)
- [ ] Confirm all endpoints that respect `?fresh=true` (likely `/network-status` and `/fee-estimate` and their subroutes).
- [ ] Update `README.md` with a "fresh cache bypass" section and request examples.

## Sanitize middleware: extend to req.body
- [ ] Update `src/middleware/sanitize.js` to sanitize `req.body` (strings, arrays, nested objects).
- [ ] Enforce the same max-length rule (500 chars) for body string values.
- [ ] Add/extend tests in `tests/sanitize.test.js` for body trimming, null-byte stripping, and 400 on >500 length.

## Standardize query parameter validation error messages (Option A)
- [ ] Update `src/utils/validators.js` error messages to use a single template (e.g., `Query parameter '<field>' ...`).
- [ ] Update inline query validation in `src/routes/account.js` for `GET /account/:id/volume` to throw `err.isValidation=true` with consistent message/field metadata.

## New endpoint: GET /account/:id/transaction-stats
- [ ] Implement the endpoint in `src/routes/account.js`.
- [ ] Add minimal query handling (if any).
- [ ] Add tests (or extend existing test coverage) to validate response shape and error handling.

## Issue #585: New Endpoint GET /account/:id/payment-summary
- [x] Add GET /:id/payment-summary route handler to `src/routes/account.js`
- [x] Add "payment-summary" to reserved words list to prevent routing conflicts
- [x] Returns { success: true, data: { totalSent, totalReceived, volumeSent, volumeReceived, topCounterparty, topAsset } }
- [x] All volume values are seven-decimal strings
- [x] Returns zeroed values for accounts with no payment history rather than a 404

## Issue #579: Add ?assets= filter to GET /account/:id/balances
- [x] Add optional ?assets= query param parsing to /balances route
- [x] "XLM" returns only native balance, "CODE:ISSUER" filters asset balances
- [x] Invalid identifiers are ignored
- [x] Returns empty array when no assets match

## Repo integrity
- [ ] Resolve merge conflict markers in `src/index.js` (currently present as `<<<<<<< HEAD` / `=======` / `>>>>>>>`).
- [ ] Ensure `npm test` passes.

## Issue #397: New Endpoint GET /transaction/:hash/effects
- [ ] Inspect existing transaction routes and response/normalization utilities
- [ ] Implement GET /transaction/:hash/effects route
  - [ ] Validate :hash is 64-char hex before Horizon call
  - [ ] Fetch all effects for transaction hash via Horizon
  - [ ] Normalize each effect with: effectId, type, account, createdAt, plus type-specific fields (best-effort)
  - [ ] Return { success: true, data: { effects: [...], total } }
  - [ ] Return 404 with clear message when transaction hash does not exist
- [x] Inspect existing transaction routes and response/normalization utilities
- [x] Implement GET /transaction/:hash/effects route
  - [x] Validate :hash is 64-char hex before Horizon call
  - [x] Fetch all effects for transaction hash via Horizon
  - [x] Normalize each effect with: effectId, type, account, createdAt, plus type-specific fields (best-effort)
  - [x] Return { success: true, data: { effects: [...], total } }
  - [x] Return 404 with clear message when transaction hash does not exist
- [x] Add/Update tests for the new endpoint (shape + validation + 404 behavior)
- [x] Ensure routing is registered in src/index.js (and docs list if applicable)
- [x] Run targeted unit tests for the endpoint only (no build)
TODO: Add Output Encoding to Error Message Interpolation

Description:
Safely encode all user-provided values interpolated into error messages to prevent malformed JSON responses and unexpected rendering when inputs contain special characters.

Requirements:

- Add a centralized output-encoding/escaping utility for user-controlled values.
- Apply encoding to all error messages that echo:
  - Account IDs
  - Asset codes
  - Policy names
- Ensure the following characters are safely escaped:
  - "<"
  - ">"
  - """
  - "\"
  - "/"
- Preserve the JSON structure of error responses regardless of malicious input.
- Ensure encoded values remain readable enough for debugging while being safe for client rendering.

Tests:

- Add unit/integration tests covering each special character for:
  - Account ID error messages
  - Asset code error messages
  - Policy name error messages
- Test combinations of special characters and malicious payloads.
- Verify every response remains valid JSON and the echoed value cannot alter the response structure.
- Verify existing normal error messages remain unchanged for safe inputs.

Acceptance Criteria:

- No user-controlled value is interpolated into an error response without encoding.
- "<", ">", """, "\", and "/" are properly escaped.
- Malicious input cannot break JSON encoding or client-side rendering.
- All relevant tests pass.
- Existing API error response formats remain backward compatible.
TODO: Add Output Encoding to Error Message Interpolation

1. Project Discovery

1. [ ] Inspect the repository structure.
2. [ ] Identify the backend/API application.
3. [ ] Identify the framework used by the backend.
4. [ ] Identify the application entry point.
5. [ ] Identify the API route directory.
6. [ ] Identify the controller directory.
7. [ ] Identify the service directory.
8. [ ] Identify the utility/helper directory.
9. [ ] Identify existing error-handling utilities.
10. [ ] Identify existing API response helpers.
11. [ ] Identify all custom application error classes.
12. [ ] Identify all error response types.
13. [ ] Identify all locations where error messages are interpolated.
14. [ ] Search for template literals in error messages.
15. [ ] Search for string concatenation in error messages.
16. [ ] Search for account ID interpolation.
17. [ ] Search for asset code interpolation.
18. [ ] Search for policy name interpolation.
19. [ ] Search for other user-controlled values in errors.
20. [ ] Search for "not found" error messages.
21. [ ] Search for "invalid" error messages.
22. [ ] Search for "unsupported" error messages.
23. [ ] Search for "already exists" error messages.
24. [ ] Search for validation errors containing request values.
25. [ ] Search for thrown errors containing request values.
26. [ ] Search for HTTP 400 responses containing request values.
27. [ ] Search for HTTP 404 responses containing request values.
28. [ ] Search for HTTP 409 responses containing request values.
29. [ ] Search for HTTP 422 responses containing request values.
30. [ ] Search for HTTP 500 responses that might echo input.
31. [ ] Review existing test files.
32. [ ] Identify tests for account-related errors.
33. [ ] Identify tests for asset-related errors.
34. [ ] Identify tests for policy-related errors.
35. [ ] Identify tests for API error responses.
36. [ ] Identify existing security-related tests.
37. [ ] Identify existing encoding utilities.
38. [ ] Check whether an HTML/entity encoder already exists.
39. [ ] Check whether an escaping dependency already exists.
40. [ ] Define the implementation scope.

2. Threat Model

41. [ ] Document that user input can appear in error messages.
42. [ ] Identify account IDs as user-controlled input.
43. [ ] Identify asset codes as user-controlled input.
44. [ ] Identify policy names as user-controlled input.
45. [ ] Identify request parameters that can reach errors.
46. [ ] Identify request body fields that can reach errors.
47. [ ] Identify query parameters that can reach errors.
48. [ ] Identify path parameters that can reach errors.
49. [ ] Identify values retrieved from external input that are echoed.
50. [ ] Determine where unsafe interpolation occurs.
51. [ ] Identify JSON-breaking characters.
52. [ ] Identify HTML-sensitive characters.
53. [ ] Identify quote characters.
54. [ ] Identify slash characters.
55. [ ] Identify angle brackets.
56. [ ] Identify backslash handling requirements.
57. [ ] Consider newline handling where applicable.
58. [ ] Consider carriage-return handling where applicable.
59. [ ] Consider tab characters where applicable.
60. [ ] Consider Unicode input.
61. [ ] Consider repeated special characters.
62. [ ] Consider very long malicious values.
63. [ ] Consider nested quote characters.
64. [ ] Consider combinations of special characters.
65. [ ] Consider encoded input supplied by clients.
66. [ ] Consider double-encoded input.
67. [ ] Consider malformed input.
68. [ ] Consider empty input.
69. [ ] Consider whitespace-only input.
70. [ ] Ensure the mitigation does not rely solely on client-side encoding.

3. Define Encoding Strategy

71. [ ] Determine the required output encoding format.
72. [ ] Confirm the encoding strategy is appropriate for JSON responses.
73. [ ] Confirm the strategy safely handles "<".
74. [ ] Confirm the strategy safely handles ">".
75. [ ] Confirm the strategy safely handles """.
76. [ ] Confirm the strategy safely handles "\".
77. [ ] Confirm the strategy safely handles "/".
78. [ ] Confirm the strategy does not produce invalid JSON.
79. [ ] Confirm encoded values remain deterministic.
80. [ ] Confirm encoded values can safely appear inside JSON strings.
81. [ ] Determine whether HTML entities are required.
82. [ ] Determine whether JSON string escaping is required.
83. [ ] Determine whether both JSON and HTML contexts need separate handling.
84. [ ] Avoid using HTML encoding blindly for JSON unless required by project behavior.
85. [ ] Avoid using URL encoding for JSON error messages.
86. [ ] Avoid using Base64 as an output-encoding substitute.
87. [ ] Avoid relying on manual backslash replacement where a trusted encoder exists.
88. [ ] Check whether the framework already safely serializes JSON values.
89. [ ] Determine whether the actual vulnerability is message construction or JSON serialization.
90. [ ] Ensure the implementation matches the acceptance criteria.
91. [ ] Define a single reusable encoding function where appropriate.
92. [ ] Give the encoding helper a descriptive name.
93. [ ] Ensure the helper accepts string input.
94. [ ] Define behavior for null values if applicable.
95. [ ] Define behavior for undefined values if applicable.
96. [ ] Define behavior for non-string values if applicable.
97. [ ] Ensure the helper does not mutate original input.
98. [ ] Ensure the helper does not modify database values.
99. [ ] Ensure the helper only affects output representation.
100. [ ] Document the chosen encoding strategy.

4. Encoding Utility

101. [ ] Create a reusable output-encoding utility if one does not exist.
102. [ ] Place the utility in the project's appropriate helper directory.
103. [ ] Follow existing project naming conventions.
104. [ ] Add strict typing.
105. [ ] Keep the utility small and focused.
106. [ ] Avoid adding unrelated functionality.
107. [ ] Implement safe handling for "<".
108. [ ] Implement safe handling for ">".
109. [ ] Implement safe handling for """.
110. [ ] Implement safe handling for "\".
111. [ ] Implement safe handling for "/".
112. [ ] Handle characters in the correct order if replacements are used.
113. [ ] Prevent replacement operations from double-encoding output.
114. [ ] Ensure already-safe characters remain unchanged.
115. [ ] Ensure ordinary alphanumeric input remains readable.
116. [ ] Ensure spaces remain valid.
117. [ ] Ensure hyphens remain valid.
118. [ ] Ensure underscores remain valid.
119. [ ] Ensure periods remain valid.
120. [ ] Ensure colons remain valid when legitimate.
121. [ ] Ensure Unicode characters remain supported.
122. [ ] Ensure non-ASCII account IDs remain safe.
123. [ ] Ensure non-ASCII asset codes remain safe.
124. [ ] Ensure non-ASCII policy names remain safe.
125. [ ] Ensure empty strings are handled.
126. [ ] Ensure repeated characters are handled.
127. [ ] Ensure long strings are handled.
128. [ ] Ensure the utility does not throw on normal input.
129. [ ] Ensure the utility does not execute user input.
130. [ ] Ensure the utility cannot introduce executable markup.
131. [ ] Ensure the utility cannot introduce malformed JSON.
132. [ ] Add unit tests for the encoding utility.
133. [ ] Test each required special character individually.
134. [ ] Test combinations of special characters.
135. [ ] Test ordinary strings.
136. [ ] Test empty strings.
137. [ ] Test Unicode strings.
138. [ ] Test repeated special characters.
139. [ ] Test long malicious strings.
140. [ ] Confirm all utility tests pass.

5. Account ID Error Messages

141. [ ] Locate account ID lookup errors.
142. [ ] Locate account-not-found errors.
143. [ ] Locate invalid-account errors.
144. [ ] Locate account validation errors.
145. [ ] Locate account-related authorization errors containing IDs.
146. [ ] Locate account-related conflict errors containing IDs.
147. [ ] Identify every account ID interpolation point.
148. [ ] Apply output encoding before interpolation.
149. [ ] Ensure raw account IDs are never inserted directly.
150. [ ] Preserve the existing error message wording.
151. [ ] Preserve the existing error type.
152. [ ] Preserve the existing HTTP status code.
153. [ ] Preserve the existing response structure.
154. [ ] Ensure only the echoed value is encoded.
155. [ ] Ensure surrounding message text remains unchanged.
156. [ ] Test account ID containing "<".
157. [ ] Test account ID containing ">".
158. [ ] Test account ID containing """.
159. [ ] Test account ID containing "\".
160. [ ] Test account ID containing "/".
161. [ ] Test account ID containing multiple special characters.
162. [ ] Test account ID containing quotes and slashes together.
163. [ ] Test account ID containing angle brackets.
164. [ ] Test account ID containing backslashes.
165. [ ] Test account ID containing malicious markup-like content.
166. [ ] Test account ID containing JSON-like content.
167. [ ] Test account ID containing escaped sequences.
168. [ ] Test account ID containing Unicode.
169. [ ] Test normal account IDs.
170. [ ] Verify account error JSON remains valid.

6. Asset Code Error Messages

171. [ ] Locate asset code lookup errors.
172. [ ] Locate asset-not-found errors.
173. [ ] Locate invalid-asset errors.
174. [ ] Locate unsupported asset errors.
175. [ ] Locate asset validation errors.
176. [ ] Identify every asset code interpolation point.
177. [ ] Apply output encoding before interpolation.
178. [ ] Ensure raw asset codes are never directly interpolated.
179. [ ] Preserve existing error message wording.
180. [ ] Preserve existing status codes.
181. [ ] Preserve existing error types.
182. [ ] Preserve existing JSON structure.
183. [ ] Test asset code containing "<".
184. [ ] Test asset code containing ">".
185. [ ] Test asset code containing """.
186. [ ] Test asset code containing "\".
187. [ ] Test asset code containing "/".
188. [ ] Test asset code containing all required special characters.
189. [ ] Test asset code containing repeated special characters.
190. [ ] Test asset code containing quote combinations.
191. [ ] Test asset code containing slash combinations.
192. [ ] Test asset code containing markup-like input.
193. [ ] Test asset code containing JSON-like input.
194. [ ] Test asset code containing Unicode.
195. [ ] Test normal asset codes.
196. [ ] Verify asset error responses remain valid JSON.
197. [ ] Verify asset error messages remain readable.
198. [ ] Verify encoding does not alter normal asset codes.
199. [ ] Verify no route behavior changes.
200. [ ] Verify all asset error tests pass.

7. Policy Name Error Messages

201. [ ] Locate policy lookup errors.
202. [ ] Locate policy-not-found errors.
203. [ ] Locate invalid-policy errors.
204. [ ] Locate policy validation errors.
205. [ ] Locate policy conflict errors.
206. [ ] Identify every policy name interpolation point.
207. [ ] Apply output encoding before interpolation.
208. [ ] Ensure raw policy names are never directly interpolated.
209. [ ] Preserve existing policy error wording.
210. [ ] Preserve existing HTTP status codes.
211. [ ] Preserve existing error types.
212. [ ] Preserve existing response structure.
213. [ ] Test policy name containing "<".
214. [ ] Test policy name containing ">".
215. [ ] Test policy name containing """.
216. [ ] Test policy name containing "\".
217. [ ] Test policy name containing "/".
218. [ ] Test policy name containing all required special characters.
219. [ ] Test policy names containing repeated special characters.
220. [ ] Test policy names containing nested quotes.
221. [ ] Test policy names containing markup-like strings.
222. [ ] Test policy names containing JSON-like strings.
223. [ ] Test policy names containing Unicode.
224. [ ] Test normal policy names.
225. [ ] Verify policy error JSON remains valid.
226. [ ] Verify policy messages remain readable.
227. [ ] Verify encoding does not alter ordinary policy names.
228. [ ] Verify no policy behavior changes.
229. [ ] Verify all policy error tests pass.
230. [ ] Confirm policy error coverage is complete.

8. Global Error Interpolation Audit

231. [ ] Search the entire project for interpolated error messages.
232. [ ] Search for template literals inside thrown errors.
233. [ ] Search for string concatenation inside errors.
234. [ ] Search for interpolated API response messages.
235. [ ] Search for "message:" properties containing variables.
236. [ ] Search for "error.message" construction.
237. [ ] Search for "throw new Error".
238. [ ] Search for framework-specific HTTP errors.
239. [ ] Search for validation error construction.
240. [ ] Search for controller-level errors.
241. [ ] Search for service-level errors.
242. [ ] Search for repository-level errors.
243. [ ] Search for request parameter interpolation.
244. [ ] Search for query parameter interpolation.
245. [ ] Search for body parameter interpolation.
246. [ ] Search for path parameter interpolation.
247. [ ] Search for headers being echoed.
248. [ ] Search for external identifiers being echoed.
249. [ ] Identify all user-controlled error values.
250. [ ] Categorize each interpolation as safe or unsafe.
251. [ ] Apply encoding to every unsafe interpolation.
252. [ ] Avoid encoding trusted static text unnecessarily.
253. [ ] Avoid encoding values that are never returned.
254. [ ] Avoid changing unrelated success responses.
255. [ ] Avoid changing database storage.
256. [ ] Avoid changing request validation semantics.
257. [ ] Avoid changing internal logs unless required.
258. [ ] Confirm internal exceptions are unaffected where appropriate.
259. [ ] Confirm public API error messages are protected.
260. [ ] Confirm the audit is complete.

9. JSON Integrity Tests

261. [ ] Create tests specifically for JSON integrity.
262. [ ] Test account ID containing a double quote.
263. [ ] Test account ID containing a backslash.
264. [ ] Test account ID containing slash characters.
265. [ ] Test account ID containing angle brackets.
266. [ ] Test asset code containing a double quote.
267. [ ] Test asset code containing a backslash.
268. [ ] Test asset code containing slash characters.
269. [ ] Test asset code containing angle brackets.
270. [ ] Test policy name containing a double quote.
271. [ ] Test policy name containing a backslash.
272. [ ] Test policy name containing slash characters.
273. [ ] Test policy name containing angle brackets.
274. [ ] Test combinations across all three input types.
275. [ ] Parse every generated response as JSON.
276. [ ] Assert JSON parsing succeeds.
277. [ ] Assert the response contains the expected "error" object.
278. [ ] Assert the expected error type remains present.
279. [ ] Assert the expected error message remains present.
280. [ ] Assert no raw malformed JSON is returned.
281. [ ] Assert no unescaped quote breaks the response.
282. [ ] Assert no backslash corrupts the response.
283. [ ] Assert special-character combinations remain valid.
284. [ ] Test malicious JSON fragments.
285. [ ] Test embedded JSON objects as input.
286. [ ] Test embedded JSON arrays as input.
287. [ ] Test strings containing escaped quotes.
288. [ ] Test strings containing repeated escape characters.
289. [ ] Test strings containing angle-bracket markup.
290. [ ] Confirm every response remains parseable.

10. Security Regression Tests

291. [ ] Add regression coverage for previously vulnerable interpolation points.
292. [ ] Verify account IDs cannot alter JSON structure.
293. [ ] Verify asset codes cannot alter JSON structure.
294. [ ] Verify policy names cannot alter JSON structure.
295. [ ] Verify encoded values cannot create executable markup.
296. [ ] Verify encoded values cannot terminate JSON strings.
297. [ ] Verify encoded values cannot add arbitrary JSON fields.
298. [ ] Verify encoded values cannot remove existing JSON fields.
299. [ ] Verify encoded values cannot modify the error type.
300. [ ] Verify encoded values cannot modify the success flag.
301. [ ] Verify encoded values cannot inject additional properties.
302. [ ] Verify encoded values cannot inject arbitrary nested JSON.
303. [ ] Verify encoded values cannot affect HTTP response structure.
304. [ ] Verify encoded values cannot affect status codes.
305. [ ] Verify encoded values cannot affect headers unexpectedly.
306. [ ] Verify encoded values remain data rather than executable content.
307. [ ] Verify normal input behavior remains unchanged.
308. [ ] Verify malformed input produces a controlled error.
309. [ ] Verify unusually long input does not crash the encoder.
310. [ ] Verify repeated malicious requests do not cause application errors.
311. [ ] Verify encoding occurs consistently.
312. [ ] Verify no vulnerable interpolation remains.
313. [ ] Run a second source-code audit after implementation.
314. [ ] Compare all identified interpolation points against the implementation.
315. [ ] Confirm every relevant point has coverage.

11. Unit Test Organization

316. [ ] Group encoding tests by input type.
317. [ ] Group account ID tests together.
318. [ ] Group asset code tests together.
319. [ ] Group policy name tests together.
320. [ ] Add clear test descriptions.
321. [ ] Make each special-character test independently identifiable.
322. [ ] Test "<" independently.
323. [ ] Test ">" independently.
324. [ ] Test """ independently.
325. [ ] Test "\" independently.
326. [ ] Test "/" independently.
327. [ ] Add combined-character tests.
328. [ ] Add normal-input tests.
329. [ ] Add empty-input tests where relevant.
330. [ ] Add Unicode tests where relevant.
331. [ ] Ensure test fixtures are deterministic.
332. [ ] Avoid dependence on external services.
333. [ ] Avoid dependence on production configuration.
334. [ ] Ensure test cleanup is performed.
335. [ ] Ensure environment state is restored.
336. [ ] Ensure tests do not modify persistent data unnecessarily.
337. [ ] Ensure tests run independently.
338. [ ] Ensure tests pass repeatedly.
339. [ ] Ensure tests cover both helper and API behavior.
340. [ ] Confirm test names describe expected security behavior.

12. API-Level Verification

341. [ ] Start the application locally.
342. [ ] Identify endpoints that trigger account errors.
343. [ ] Send malicious account ID input.
344. [ ] Confirm the API returns the expected error.
345. [ ] Confirm the response can be parsed as JSON.
346. [ ] Send malicious asset code input.
347. [ ] Confirm the API returns the expected error.
348. [ ] Confirm the response can be parsed as JSON.
349. [ ] Send malicious policy name input.
350. [ ] Confirm the API returns the expected error.
351. [ ] Confirm the response can be parsed as JSON.
352. [ ] Test each special character individually.
353. [ ] Test all characters together.
354. [ ] Test nested special-character combinations.
355. [ ] Test normal values.
356. [ ] Compare normal response behavior before and after the change.
357. [ ] Confirm status codes remain unchanged.
358. [ ] Confirm error types remain unchanged.
359. [ ] Confirm response structure remains unchanged.
360. [ ] Confirm only unsafe interpolated values are encoded.

13. Full Project Validation

361. [ ] Run the complete unit test suite.
362. [ ] Run integration tests.
363. [ ] Run API tests.
364. [ ] Run security-related tests.
365. [ ] Run linting.
366. [ ] Run formatting checks.
367. [ ] Run TypeScript type checking.
368. [ ] Run the production build.
369. [ ] Confirm no new compilation errors.
370. [ ] Confirm no new lint errors.
371. [ ] Confirm no new formatting errors.
372. [ ] Confirm no unrelated tests fail.
373. [ ] Investigate any pre-existing failures.
374. [ ] Confirm all new tests pass.
375. [ ] Confirm all acceptance criteria are covered.
376. [ ] Perform a final source-code search for unsafe interpolation.
377. [ ] Review all changed files.
378. [ ] Remove unused imports.
379. [ ] Remove unnecessary helper functions.
380. [ ] Remove debugging statements.
381. [ ] Remove temporary test code.
382. [ ] Ensure no sensitive data was added.
383. [ ] Ensure no dependency was added unnecessarily.
384. [ ] Ensure the implementation follows project conventions.
385. [ ] Ensure the implementation is backwards compatible.

14. Final Acceptance Checklist

386. [ ] User-controlled account IDs are safely encoded before error-message interpolation.
387. [ ] User-controlled asset codes are safely encoded before error-message interpolation.
388. [ ] User-controlled policy names are safely encoded before error-message interpolation.
389. [ ] "<" is safely handled.
390. [ ] ">" is safely handled.
391. [ ] """ is safely handled.
392. [ ] "\" is safely handled.
393. [ ] "/" is safely handled.
394. [ ] Malicious input cannot break JSON structure.
395. [ ] Error response JSON remains parseable.
396. [ ] Error types remain unchanged.
397. [ ] HTTP status codes remain unchanged.
398. [ ] Existing normal error behavior remains intact.
399. [ ] Tests cover every required special-character type across account ID, asset code, and policy name messages.
400. [ ] Final implementation is reviewed, tested, and ready for pull request.
TODO: Automated Scanner User-Agent Blocking Middleware

1. Project Discovery & Preparation

1. [ ] Inspect the project structure.
2. [ ] Identify the backend application entry point.
3. [ ] Identify the framework currently used by the API.
4. [ ] Locate existing middleware implementations.
5. [ ] Locate the existing route registration.
6. [ ] Locate the application's global error-handling mechanism.
7. [ ] Locate existing HTTP response helpers.
8. [ ] Locate existing authentication/authorization middleware.
9. [ ] Identify where global middleware is registered.
10. [ ] Identify the current test framework.
11. [ ] Locate existing middleware tests.
12. [ ] Review existing API response conventions.
13. [ ] Review existing 403/Forbidden responses.
14. [ ] Review existing environment-variable configuration.
15. [ ] Locate the ".env.example" file.
16. [ ] Confirm whether environment variables are loaded centrally.
17. [ ] Identify the preferred configuration module.
18. [ ] Review project coding conventions.
19. [ ] Review linting rules.
20. [ ] Review formatting rules.
21. [ ] Review TypeScript configuration if applicable.
22. [ ] Review package scripts.
23. [ ] Identify the command used to run unit tests.
24. [ ] Identify the command used to run integration tests.
25. [ ] Identify the command used to run linting.
26. [ ] Identify the command used to build the application.
27. [ ] Check whether middleware ordering is covered by tests.
28. [ ] Check whether requests pass through a common API layer.
29. [ ] Check whether health-check routes exist.
30. [ ] Determine whether scanner blocking should apply globally.
31. [ ] Confirm the requirement that blocking occurs before route handlers.
32. [ ] Confirm no route-specific implementation is needed.
33. [ ] Confirm no database changes are required.
34. [ ] Confirm no frontend changes are required.
35. [ ] Confirm the feature is server-side only.
36. [ ] Create or switch to the appropriate development branch.
37. [ ] Review the latest project state before modifying files.
38. [ ] Ensure the working tree is clean where appropriate.
39. [ ] Record the files expected to change.
40. [ ] Define the implementation scope.

2. Environment Configuration

41. [ ] Define the "BLOCKED_USER_AGENTS" environment variable.
42. [ ] Document that the variable accepts comma-separated patterns.
43. [ ] Add "BLOCKED_USER_AGENTS" to ".env.example".
44. [ ] Include representative scanner names in ".env.example".
45. [ ] Include "sqlmap" in the example blocklist.
46. [ ] Include "nikto" in the example blocklist.
47. [ ] Include "masscan" in the example blocklist.
48. [ ] Include "zgrab" in the example blocklist.
49. [ ] Keep the example configuration easy to understand.
50. [ ] Avoid hard-coding the blocklist inside middleware.
51. [ ] Ensure production configuration can override the example values.
52. [ ] Confirm missing "BLOCKED_USER_AGENTS" does not crash the application.
53. [ ] Treat an empty environment variable as an empty blocklist.
54. [ ] Handle surrounding whitespace in configured values.
55. [ ] Ignore empty entries caused by consecutive commas.
56. [ ] Normalize configuration values consistently.
57. [ ] Decide whether matching should be case-insensitive.
58. [ ] Implement case-insensitive matching for scanner names.
59. [ ] Document the matching behavior.
60. [ ] Avoid exposing environment configuration in API responses.
61. [ ] Ensure the blocklist is read from configuration.
62. [ ] Avoid requiring application code changes for new blocked agents.
63. [ ] Confirm environment loading occurs before middleware initialization.
64. [ ] Confirm test environments can provide custom blocklists.
65. [ ] Add configuration tests if the project structure supports them.
66. [ ] Verify ".env.example" syntax remains valid.
67. [ ] Verify no secrets are added to ".env.example".
68. [ ] Verify scanner names are examples rather than sensitive values.
69. [ ] Document how operators can extend the blocklist.
70. [ ] Keep configuration naming exactly as specified.

3. Middleware Design

71. [ ] Create a dedicated user-agent blocking middleware.
72. [ ] Give the middleware a descriptive name.
73. [ ] Keep the middleware focused on user-agent filtering.
74. [ ] Avoid mixing authentication logic into this middleware.
75. [ ] Avoid mixing rate limiting into this middleware.
76. [ ] Avoid modifying unrelated request behavior.
77. [ ] Read the incoming "User-Agent" header.
78. [ ] Handle the absence of the "User-Agent" header.
79. [ ] Allow requests without a user agent.
80. [ ] Do not treat missing user agent as suspicious by itself.
81. [ ] Read the configured "BLOCKED_USER_AGENTS" values.
82. [ ] Parse the environment variable as comma-separated values.
83. [ ] Trim whitespace from each configured pattern.
84. [ ] Remove empty patterns.
85. [ ] Normalize values for case-insensitive matching.
86. [ ] Normalize the incoming user agent for comparison.
87. [ ] Compare the request user agent against configured patterns.
88. [ ] Support recognisable scanner identifiers such as "sqlmap".
89. [ ] Support recognisable scanner identifiers such as "nikto".
90. [ ] Support recognisable scanner identifiers such as "masscan".
91. [ ] Support recognisable scanner identifiers such as "zgrab".
92. [ ] Ensure scanner names embedded in a longer User-Agent are detected.
93. [ ] Avoid requiring an exact full-string User-Agent match.
94. [ ] Use substring/pattern matching appropriate to the requirement.
95. [ ] Consider safely supporting regular-expression patterns only if project requirements call for them.
96. [ ] Avoid unsafe dynamic regular-expression behavior if simple substring matching is sufficient.
97. [ ] Prevent malformed configuration from crashing requests.
98. [ ] Ensure matching is deterministic.
99. [ ] Ensure the middleware has minimal processing overhead.
100. [ ] Return immediately when a blocked match is found.
101. [ ] Do not call the next middleware after a blocked match.
102. [ ] Do not call the route handler after a blocked match.
103. [ ] Do not perform unnecessary database queries.
104. [ ] Do not perform authentication work before blocking if ordering permits.
105. [ ] Do not expose the matched scanner name.
106. [ ] Do not expose the configured blocklist.
107. [ ] Do not reveal internal implementation details.
108. [ ] Keep the middleware reusable.
109. [ ] Keep the implementation easy to unit test.
110. [ ] Add comments only where they clarify non-obvious behavior.

4. Middleware Registration

111. [ ] Locate the global middleware registration point.
112. [ ] Register the scanner-blocking middleware globally.
113. [ ] Place it before route handlers.
114. [ ] Ensure it executes before protected routes.
115. [ ] Ensure it executes before public API routes.
116. [ ] Ensure it executes before expensive route processing.
117. [ ] Ensure it executes before database-heavy handlers.
118. [ ] Ensure it executes before controller execution.
119. [ ] Verify middleware ordering explicitly.
120. [ ] Ensure the middleware does not bypass normal requests.
121. [ ] Ensure "next()" is called for allowed requests.
122. [ ] Ensure "next()" is not called for blocked requests.
123. [ ] Ensure registration does not duplicate the middleware.
124. [ ] Ensure middleware registration does not affect static assets unexpectedly unless intended.
125. [ ] Confirm the intended application-wide scope.
126. [ ] Verify the middleware is active in development.
127. [ ] Verify the middleware is active in tests.
128. [ ] Verify the middleware is active in production builds.
129. [ ] Verify configuration is available when middleware starts.
130. [ ] Confirm startup does not fail when the blocklist is empty.

5. Forbidden Response

131. [ ] Implement a 403 response for blocked requests.
132. [ ] Set the HTTP status code to "403".
133. [ ] Return the required JSON response structure.
134. [ ] Set "success" to "false".
135. [ ] Set "error.type" to "Forbidden".
136. [ ] Set "error.message" to "Access denied.".
137. [ ] Match the required capitalization exactly.
138. [ ] Match the required punctuation exactly.
139. [ ] Avoid returning the scanner User-Agent in the response.
140. [ ] Avoid returning additional diagnostic information.
141. [ ] Ensure the response is valid JSON.
142. [ ] Ensure the response uses the application's normal JSON response mechanism where appropriate.
143. [ ] Ensure response headers are appropriate.
144. [ ] Ensure blocked requests cannot reach route handlers.
145. [ ] Verify the response body against the acceptance criteria.
146. [ ] Verify the status code independently from the response body.
147. [ ] Verify content type where applicable.
148. [ ] Verify the error response is consistent across affected routes.
149. [ ] Verify no stack trace is returned.
150. [ ] Verify no internal configuration is returned.

6. Matching Behavior

151. [ ] Test exact scanner User-Agent values.
152. [ ] Test scanner names embedded in User-Agent strings.
153. [ ] Test uppercase scanner names.
154. [ ] Test lowercase scanner names.
155. [ ] Test mixed-case scanner names.
156. [ ] Test leading/trailing whitespace in configuration.
157. [ ] Test multiple configured scanner patterns.
158. [ ] Test one blocked pattern among several allowed patterns.
159. [ ] Test an empty blocklist.
160. [ ] Test a missing "BLOCKED_USER_AGENTS" variable.
161. [ ] Test an empty "User-Agent".
162. [ ] Test a missing "User-Agent".
163. [ ] Ensure missing "User-Agent" requests are allowed.
164. [ ] Test a normal browser User-Agent.
165. [ ] Test a mobile browser User-Agent.
166. [ ] Test an API client User-Agent.
167. [ ] Test a custom application User-Agent.
168. [ ] Confirm normal clients are not accidentally blocked.
169. [ ] Confirm only configured patterns trigger blocking.
170. [ ] Confirm partial matching behaves as intended.
171. [ ] Confirm matching is case-insensitive.
172. [ ] Confirm whitespace normalization works.
173. [ ] Confirm empty configuration entries are ignored.
174. [ ] Confirm adding a new pattern requires no code change.
175. [ ] Confirm removing a pattern allows matching requests again.
176. [ ] Confirm configuration changes take effect according to application configuration lifecycle.
177. [ ] Confirm no false positive is introduced by unrelated User-Agent text.
178. [ ] Document any deliberate matching limitations.
179. [ ] Keep matching behavior predictable.
180. [ ] Keep matching logic covered by tests.

7. Unit Tests

181. [ ] Create or update middleware unit tests.
182. [ ] Add a test for a blocked "sqlmap" User-Agent.
183. [ ] Assert the blocked request receives status "403".
184. [ ] Assert "success" is "false".
185. [ ] Assert "error.type" equals "Forbidden".
186. [ ] Assert "error.message" equals "Access denied.".
187. [ ] Assert the next handler is not called.
188. [ ] Add a test for a blocked "nikto" User-Agent.
189. [ ] Add a test for a blocked "masscan" User-Agent.
190. [ ] Add a test for a blocked "zgrab" User-Agent.
191. [ ] Add a test for a normal allowed User-Agent.
192. [ ] Assert allowed requests continue.
193. [ ] Assert the next handler is called for allowed requests.
194. [ ] Add a test for a missing User-Agent.
195. [ ] Assert missing User-Agent requests are allowed.
196. [ ] Assert the next handler is called for missing User-Agent requests.
197. [ ] Add a test for case-insensitive matching.
198. [ ] Add a test for multiple configured patterns.
199. [ ] Add a test for whitespace around patterns.
200. [ ] Add a test for an empty blocklist.
201. [ ] Add a test for an unset blocklist.
202. [ ] Add a test for an unrelated scanner-like string if needed.
203. [ ] Confirm tests isolate environment configuration.
204. [ ] Restore environment variables after each test.
205. [ ] Prevent test configuration leaking between cases.
206. [ ] Avoid depending on developer-local ".env" values.
207. [ ] Use deterministic test configuration.
208. [ ] Keep tests readable.
209. [ ] Give tests descriptive names.
210. [ ] Ensure assertions cover both status and body.

8. Integration Tests

211. [ ] Identify an API endpoint suitable for middleware testing.
212. [ ] Add an integration test for a blocked request.
213. [ ] Send a blocked scanner User-Agent.
214. [ ] Verify the request receives HTTP 403.
215. [ ] Verify the response JSON structure.
216. [ ] Verify the route handler is not executed.
217. [ ] Add an integration test for an allowed User-Agent.
218. [ ] Verify the request reaches the route handler.
219. [ ] Verify the normal endpoint response remains unchanged.
220. [ ] Add an integration test without a User-Agent.
221. [ ] Verify the request remains allowed.
222. [ ] Verify existing authentication behavior is not unintentionally changed.
223. [ ] Verify existing API error handling remains functional.
224. [ ] Verify middleware ordering through observable behavior.
225. [ ] Ensure the tests exercise the actual application middleware stack.
226. [ ] Avoid testing only the middleware function where ordering matters.
227. [ ] Confirm blocked requests are stopped before route execution.
228. [ ] Confirm no side effects occur from blocked requests.
229. [ ] Confirm normal requests remain unaffected.
230. [ ] Keep integration tests deterministic.

9. Security & Reliability Review

231. [ ] Review middleware for bypasses caused by casing.
232. [ ] Review middleware for bypasses caused by surrounding whitespace.
233. [ ] Review middleware for missing headers.
234. [ ] Review middleware for unusually long User-Agent values.
235. [ ] Review middleware for malformed environment configuration.
236. [ ] Ensure matching does not throw on unexpected input.
237. [ ] Ensure matching does not expose internal errors.
238. [ ] Ensure blocked requests are rejected early.
239. [ ] Ensure route handlers cannot override the 403 decision.
240. [ ] Ensure the middleware cannot accidentally allow blocked requests.
241. [ ] Ensure normal clients are not broadly blocked.
242. [ ] Review the chosen matching strategy for false positives.
243. [ ] Review whether patterns should be treated as literal strings.
244. [ ] Avoid introducing unnecessary regex complexity.
245. [ ] Avoid evaluating untrusted configuration as executable code.
246. [ ] Avoid logging full malicious User-Agent strings unless logging policy permits it.
247. [ ] Avoid logging sensitive request information.
248. [ ] Consider whether blocked requests should be logged.
249. [ ] If logging is implemented, keep it structured and minimal.
250. [ ] Ensure logging cannot create excessive log volume.

10. Documentation

251. [ ] Update ".env.example".
252. [ ] Document the purpose of "BLOCKED_USER_AGENTS".
253. [ ] Document comma-separated configuration.
254. [ ] Document that matching is case-insensitive.
255. [ ] Document that configured patterns are matched against the User-Agent.
256. [ ] Document that requests without a User-Agent are allowed.
257. [ ] Document the 403 response behavior.
258. [ ] Document how to add another scanner identifier.
259. [ ] Ensure documentation does not imply this is a complete security solution.
260. [ ] Clarify that User-Agent blocking is one layer of defense.
261. [ ] Avoid documenting sensitive deployment configuration.
262. [ ] Keep documentation consistent with actual implementation.
263. [ ] Update relevant architecture documentation if required.
264. [ ] Update API/security documentation if present.
265. [ ] Add a short implementation note if the project maintains changelogs.
266. [ ] Confirm ".env.example" remains synchronized with configuration names.
267. [ ] Remove obsolete configuration references if discovered.
268. [ ] Check documentation for incorrect variable names.
269. [ ] Check documentation for incorrect response examples.
270. [ ] Keep the final documentation concise.

11. Validation

271. [ ] Run unit tests.
272. [ ] Run middleware-specific tests.
273. [ ] Run integration tests.
274. [ ] Run the complete test suite.
275. [ ] Run linting.
276. [ ] Run formatting checks.
277. [ ] Run the production build.
278. [ ] Verify no TypeScript errors occur if applicable.
279. [ ] Verify no unused imports are introduced.
280. [ ] Verify no environment-variable validation errors occur.
281. [ ] Manually start the application with scanner blocklist configuration.
282. [ ] Send a request using a blocked User-Agent.
283. [ ] Confirm HTTP 403.
284. [ ] Confirm the exact JSON error body.
285. [ ] Send a request using a normal browser User-Agent.
286. [ ] Confirm the request succeeds normally.
287. [ ] Send a request without a User-Agent.
288. [ ] Confirm the request succeeds normally.
289. [ ] Test changing the blocklist configuration.
290. [ ] Confirm newly configured patterns are blocked after configuration reload/restart as applicable.
291. [ ] Confirm removed patterns are no longer blocked after configuration reload/restart as applicable.
292. [ ] Verify middleware runs before route handlers.
293. [ ] Verify no unrelated endpoints regress.
294. [ ] Review the final diff.
295. [ ] Remove unnecessary changes.
296. [ ] Confirm all acceptance criteria are explicitly covered by tests.
297. [ ] Confirm ".env.example" is updated.
298. [ ] Confirm blocked requests return the exact required 403 response.
299. [ ] Confirm allowed and missing User-Agent cases pass.
300. [ ] Mark the task complete and prepare the implementation for review.
301. TODO: Write "docs/security.md" Security Guide

1. Repository Discovery

1. [ ] Inspect the StellarKit API repository structure.
2. [ ] Locate the root "README.md".
3. [ ] Check whether a "docs/" directory already exists.
4. [ ] Check whether "docs/security.md" already exists.
5. [ ] Inspect existing documentation style.
6. [ ] Review existing Markdown conventions.
7. [ ] Review existing documentation headings.
8. [ ] Review existing code examples.
9. [ ] Review existing configuration documentation.
10. [ ] Review existing deployment documentation.
11. [ ] Review existing API authentication documentation.
12. [ ] Review existing rate-limiting documentation.
13. [ ] Review existing webhook documentation.
14. [ ] Review existing CORS documentation.
15. [ ] Review existing environment-variable documentation.
16. [ ] Review existing security-related comments in source code.
17. [ ] Search the repository for authentication configuration.
18. [ ] Search the repository for API key handling.
19. [ ] Search the repository for rate-limit configuration.
20. [ ] Search the repository for CORS configuration.
21. [ ] Search the repository for webhook signature verification.
22. [ ] Search the repository for security middleware.
23. [ ] Search the repository for authorization checks.
24. [ ] Search the repository for request validation.
25. [ ] Search the repository for security headers.
26. [ ] Search the repository for error handling.
27. [ ] Search the repository for environment variables.
28. [ ] Search for production configuration examples.
29. [ ] Search for deployment instructions.
30. [ ] Search for known security limitations.
31. [ ] Identify the API framework.
32. [ ] Identify the authentication mechanism.
33. [ ] Identify the authorization mechanism.
34. [ ] Identify the rate limiter implementation.
35. [ ] Identify the CORS implementation.
36. [ ] Identify the webhook verification implementation.
37. [ ] Identify API-key generation/storage behavior.
38. [ ] Identify logging behavior.
39. [ ] Identify monitoring hooks.
40. [ ] Define the documentation scope.

2. Security Model Overview

41. [ ] Create "docs/security.md".
42. [ ] Add a clear security guide title.
43. [ ] Add an introduction to StellarKit's security model.
44. [ ] Explain the API's security boundaries.
45. [ ] Explain what security controls are built into StellarKit.
46. [ ] Explain what controls require operator configuration.
47. [ ] Explain what controls are outside the API's responsibility.
48. [ ] Describe authentication at a high level.
49. [ ] Describe authorization at a high level.
50. [ ] Describe request validation.
51. [ ] Describe rate limiting.
52. [ ] Describe CORS protection.
53. [ ] Describe webhook signature verification.
54. [ ] Describe API key handling.
55. [ ] Describe secure deployment expectations.
56. [ ] Explain the principle of least privilege.
57. [ ] Explain defense in depth.
58. [ ] Explain secure secret management.
59. [ ] Explain transport security.
60. [ ] Explain the importance of HTTPS.
61. [ ] Explain production environment separation.
62. [ ] Explain operator responsibilities.
63. [ ] Explain application responsibilities.
64. [ ] Explain infrastructure responsibilities.
65. [ ] Avoid claiming protections that the API does not provide.
66. [ ] Avoid making unsupported security guarantees.
67. [ ] Ensure every documented security feature matches the code.
68. [ ] Ensure terminology is consistent.
69. [ ] Keep the security model understandable to operators.
70. [ ] Add a concise security architecture summary.

3. Authentication & Authorization

71. [ ] Document the authentication mechanism.
72. [ ] Explain when authentication is required.
73. [ ] Explain how API keys are supplied if applicable.
74. [ ] Explain how API keys are validated.
75. [ ] Explain authorization behavior.
76. [ ] Document available authorization boundaries.
77. [ ] Explain permission enforcement where applicable.
78. [ ] Explain failed authentication behavior.
79. [ ] Explain failed authorization behavior.
80. [ ] Document relevant HTTP status codes.
81. [ ] Explain authentication-related configuration.
82. [ ] Document required authentication environment variables.
83. [ ] Document secure values for production.
84. [ ] Explain secret rotation expectations.
85. [ ] Explain credential revocation where supported.
86. [ ] Explain account/service separation where applicable.
87. [ ] Recommend least-privilege credentials.
88. [ ] Recommend separate development and production credentials.
89. [ ] Recommend avoiding shared credentials.
90. [ ] Document credential lifecycle best practices.
91. [ ] Avoid publishing real credentials in examples.
92. [ ] Use placeholders for all secrets.
93. [ ] Warn operators against committing secrets.
94. [ ] Explain how authentication interacts with rate limiting.
95. [ ] Explain how authentication interacts with webhooks where relevant.
96. [ ] Explain any authentication limitations.
97. [ ] Verify authentication claims against source code.
98. [ ] Verify authorization claims against source code.
99. [ ] Remove unsupported authentication claims.
100. [ ] Finalize the authentication section.

4. Production Configuration Checklist

101. [ ] Add a production security checklist.
102. [ ] Require HTTPS in production.
103. [ ] Recommend secure TLS termination.
104. [ ] Recommend protecting internal services from public exposure.
105. [ ] Document required production environment variables.
106. [ ] Document authentication configuration.
107. [ ] Document API key configuration.
108. [ ] Document rate-limit configuration.
109. [ ] Document CORS configuration.
110. [ ] Document webhook secret configuration.
111. [ ] Recommend strong secrets.
112. [ ] Recommend secret storage outside source control.
113. [ ] Recommend a secrets manager where appropriate.
114. [ ] Recommend rotating secrets periodically.
115. [ ] Recommend separate secrets by environment.
116. [ ] Recommend restricting production access.
117. [ ] Recommend least-privilege infrastructure permissions.
118. [ ] Recommend keeping dependencies updated.
119. [ ] Recommend monitoring application logs.
120. [ ] Recommend monitoring authentication failures.
121. [ ] Recommend monitoring rate-limit events.
122. [ ] Recommend monitoring webhook failures.
123. [ ] Recommend monitoring unexpected traffic.
124. [ ] Recommend backups where persistent data exists.
125. [ ] Recommend recovery procedures.
126. [ ] Recommend secure deployment pipelines.
127. [ ] Recommend protecting CI/CD secrets.
128. [ ] Recommend disabling development/debug configuration.
129. [ ] Recommend reviewing configuration before deployment.
130. [ ] Add a production-readiness checklist operators can follow.

5. Rate Limiting Configuration

131. [ ] Document the purpose of rate limiting.
132. [ ] Explain what rate limiting protects against.
133. [ ] Explain what rate limiting does not protect against.
134. [ ] Identify the configured rate-limit mechanism.
135. [ ] Document the relevant environment variables.
136. [ ] Document the default rate limit if applicable.
137. [ ] Document the request window.
138. [ ] Document burst behavior if applicable.
139. [ ] Document how clients are identified.
140. [ ] Explain whether limits are per API key.
141. [ ] Explain whether limits are per IP.
142. [ ] Explain any proxy considerations.
143. [ ] Explain trusted proxy configuration if applicable.
144. [ ] Document rate-limit response behavior.
145. [ ] Document the relevant HTTP status.
146. [ ] Document rate-limit headers if available.
147. [ ] Explain how operators can tune limits.
148. [ ] Recommend conservative production defaults.
149. [ ] Explain trade-offs when increasing limits.
150. [ ] Explain trade-offs when decreasing limits.
151. [ ] Explain that rate limiting is not DDoS protection.
152. [ ] Explain infrastructure-level protection requirements.
153. [ ] Recommend upstream WAF/CDN protection where appropriate.
154. [ ] Explain how authenticated and unauthenticated traffic is handled.
155. [ ] Document rate-limit configuration examples.
156. [ ] Use safe example values.
157. [ ] Ensure examples match actual configuration syntax.
158. [ ] Explain how to test rate limiting.
159. [ ] Document common rate-limit troubleshooting steps.
160. [ ] Finalize the rate-limiting section.

6. API Key Security

161. [ ] Add an API key security section.
162. [ ] Explain API key sensitivity.
163. [ ] Explain that API keys should be treated as secrets.
164. [ ] Recommend storing keys in environment variables or a secret manager.
165. [ ] Recommend never committing keys to Git.
166. [ ] Recommend never placing keys in public documentation.
167. [ ] Recommend avoiding keys in frontend source code.
168. [ ] Recommend avoiding keys in URLs where applicable.
169. [ ] Recommend avoiding keys in logs.
170. [ ] Recommend avoiding keys in analytics payloads.
171. [ ] Explain API key rotation.
172. [ ] Explain API key revocation where supported.
173. [ ] Explain key ownership.
174. [ ] Explain separate keys for different environments.
175. [ ] Explain least-privilege usage.
176. [ ] Explain how leaked keys should be handled.
177. [ ] Document immediate key rotation after suspected exposure.
178. [ ] Recommend auditing key usage.
179. [ ] Recommend monitoring suspicious API-key activity.
180. [ ] Explain storage considerations.
181. [ ] Explain transmission over HTTPS.
182. [ ] Explain why plaintext HTTP should not be used.
183. [ ] Document safe example configuration.
184. [ ] Ensure examples contain no real secrets.
185. [ ] Document API-key-related failure behavior.
186. [ ] Verify documented behavior against source code.
187. [ ] Avoid promising unsupported key-management functionality.
188. [ ] Add an API-key security checklist.
189. [ ] Review the section for clarity.
190. [ ] Finalize the API-key section.

7. CORS Configuration

191. [ ] Add a CORS security section.
192. [ ] Explain what CORS does.
193. [ ] Explain what CORS does not do.
194. [ ] Identify the CORS implementation.
195. [ ] Identify the CORS configuration variable.
196. [ ] Document allowed origins.
197. [ ] Document the production origin configuration.
198. [ ] Recommend explicit allowed origins.
199. [ ] Warn against unrestricted wildcard origins where inappropriate.
200. [ ] Explain credentials behavior.
201. [ ] Explain preflight requests.
202. [ ] Explain allowed methods if configurable.
203. [ ] Explain allowed headers if configurable.
204. [ ] Document development CORS configuration.
205. [ ] Document production CORS configuration.
206. [ ] Explain the risks of overly permissive CORS.
207. [ ] Explain that CORS is not authentication.
208. [ ] Explain that CORS does not protect server-to-server clients.
209. [ ] Explain that CORS does not prevent direct API requests.
210. [ ] Recommend pairing CORS with authentication.
211. [ ] Provide safe configuration examples.
212. [ ] Ensure examples match actual project syntax.
213. [ ] Document common CORS errors.
214. [ ] Explain how operators can troubleshoot CORS failures.
215. [ ] Verify all claims against implementation.
216. [ ] Avoid documenting unsupported CORS options.
217. [ ] Add a CORS production checklist.
218. [ ] Review origin configuration examples.
219. [ ] Confirm no insecure wildcard recommendation is made.
220. [ ] Finalize the CORS section.

8. Webhook Signature Security

221. [ ] Add a webhook security section.
222. [ ] Explain why webhook signatures are necessary.
223. [ ] Identify the webhook signature mechanism.
224. [ ] Identify the webhook signing secret configuration.
225. [ ] Document how signatures are generated if appropriate.
226. [ ] Document how signatures are verified.
227. [ ] Explain that verification must occur before processing payloads.
228. [ ] Explain secret storage requirements.
229. [ ] Recommend webhook secrets be stored securely.
230. [ ] Recommend HTTPS for webhook endpoints.
231. [ ] Explain replay protection if supported.
232. [ ] Document timestamp validation if supported.
233. [ ] Document signature headers.
234. [ ] Document webhook verification failure behavior.
235. [ ] Document relevant HTTP status codes.
236. [ ] Explain secret rotation where supported.
237. [ ] Explain how operators should respond to leaked webhook secrets.
238. [ ] Explain webhook endpoint exposure considerations.
239. [ ] Explain that signature verification authenticates the sender but does not make payloads inherently safe.
240. [ ] Recommend validating webhook payloads after signature verification.
241. [ ] Recommend idempotent webhook processing.
242. [ ] Recommend monitoring repeated verification failures.
243. [ ] Provide a safe webhook configuration example.
244. [ ] Ensure the example does not contain a real secret.
245. [ ] Verify webhook claims against source code.
246. [ ] Avoid documenting unsupported signature algorithms.
247. [ ] Avoid claiming replay protection if it is not implemented.
248. [ ] Add webhook troubleshooting guidance.
249. [ ] Add a webhook security checklist.
250. [ ] Finalize the webhook section.

9. What StellarKit Does Not Protect Against

251. [ ] Add a clear limitations section.
252. [ ] Explain that StellarKit is not a complete security boundary.
253. [ ] Explain that operators remain responsible for infrastructure security.
254. [ ] Explain that StellarKit does not replace HTTPS.
255. [ ] Explain that StellarKit does not replace firewall controls.
256. [ ] Explain that StellarKit does not replace WAF protection.
257. [ ] Explain that rate limiting does not provide DDoS protection.
258. [ ] Explain that CORS does not prevent direct API access.
259. [ ] Explain that API keys can be compromised if operators mishandle them.
260. [ ] Explain that webhook signatures do not replace payload validation.
261. [ ] Explain that secure secrets management is an operator responsibility.
262. [ ] Explain that dependency vulnerabilities remain an operational concern.
263. [ ] Explain that host/server compromise is outside API-level protection.
264. [ ] Explain that compromised operator credentials are outside API protection.
265. [ ] Explain that application-level business-logic vulnerabilities may remain possible.
266. [ ] Explain that client-side security is outside the API's responsibility.
267. [ ] Explain that database security requires appropriate infrastructure controls.
268. [ ] Explain that logging and monitoring require operator configuration.
269. [ ] Explain that backups and disaster recovery are operator responsibilities.
270. [ ] Avoid overstating any limitation not supported by the code.
271. [ ] Review every limitation for accuracy.
272. [ ] Make the distinction between API controls and operator controls explicit.
273. [ ] Add an operator responsibility summary.
274. [ ] Add an API responsibility summary.
275. [ ] Finalize the limitations section.

10. README Integration

276. [ ] Open the root "README.md".
277. [ ] Identify the appropriate documentation section.
278. [ ] Add a "Security" section if one does not exist.
279. [ ] Link the security guide from the README.
280. [ ] Point the link to "docs/security.md".
281. [ ] Use descriptive link text.
282. [ ] Ensure the link works from GitHub.
283. [ ] Avoid duplicating the complete security guide in README.
284. [ ] Keep the README addition concise.
285. [ ] Ensure the Security section is easy to find.

11. Validation & Review

286. [ ] Review "docs/security.md" for completeness.
287. [ ] Confirm the security model is documented.
288. [ ] Confirm the production checklist is documented.
289. [ ] Confirm rate limiting is documented.
290. [ ] Confirm API key security is documented.
291. [ ] Confirm CORS configuration is documented.
292. [ ] Confirm webhook signature security is documented.
293. [ ] Confirm StellarKit limitations are documented.
294. [ ] Confirm README links to the guide.
295. [ ] Run Markdown/lint checks if available.
296. [ ] Check all documentation links.
297. [ ] Verify all configuration examples against the actual code.
298. [ ] Review the final Git diff and remove unrelated changes.
299. [ ] Confirm the PR description includes "Closes #786".
300. [ ] Confirm all acceptance criteria are satisfied and the documentation is ready for review.
