import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRequest, PROVIDERS } from "../llm/hosted.js";

const item = {
  id: "t", prompt: "Which?",
  poles: [{ id: "a", label: "Alpha" }, { id: "b", label: "Bravo" }],
};
const args = { item, freeText: "depends", key: "SECRET_KEY" };

test("gemini: key in query, schema stripped of unsupported keywords", () => {
  const { url, init } = buildRequest("gemini", { ...args });
  assert.ok(url.startsWith("https://generativelanguage.googleapis.com/v1beta/models/"));
  assert.ok(url.includes(":streamGenerateContent"));
  assert.ok(url.includes("alt=sse"));
  assert.ok(url.includes("key=SECRET_KEY"));

  const body = JSON.parse(init.body);
  assert.ok(body.systemInstruction.parts[0].text.length > 0);
  assert.equal(body.contents[0].role, "user");
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.equal(body.generationConfig.temperature, 0);
  // Gemini's OpenAPI subset rejects additionalProperties.
  assert.equal("additionalProperties" in body.generationConfig.responseSchema, false);
  assert.deepEqual(body.generationConfig.responseSchema.properties.pole.enum, ["a", "b"]);
});

test("groq: bearer auth, OpenAI-shaped body, JSON mode on", () => {
  const { url, init } = buildRequest("groq", { ...args });
  assert.equal(url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(init.headers.Authorization, "Bearer SECRET_KEY");

  const body = JSON.parse(init.body);
  assert.equal(body.model, PROVIDERS.groq.defaultModel);
  assert.equal(body.stream, true);
  assert.equal(body.temperature, 0);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.messages[0].role, "system");
  assert.equal(body.messages[1].role, "user");
});

test("the visitor's answer reaches the model verbatim", () => {
  const { init } = buildRequest("groq", { ...args, freeText: 'it "depends" on the friend' });
  assert.ok(JSON.parse(init.body).messages[1].content.includes('it \\"depends\\" on the friend'));
});

test("an explicit model overrides the provider default", () => {
  const { init } = buildRequest("groq", { ...args, model: "llama-3.1-8b-instant" });
  assert.equal(JSON.parse(init.body).model, "llama-3.1-8b-instant");
});

test("an unknown provider is refused, not guessed at", () => {
  assert.throws(() => buildRequest("nope", args), /Unknown provider/);
});

test("no key belonging to this site is embedded anywhere", () => {
  const { url, init } = buildRequest("gemini", { ...args, key: "" });
  assert.equal(url.includes("key=&") || url.endsWith("key="), true);
  assert.equal(init.body.includes("SECRET"), false);
});
