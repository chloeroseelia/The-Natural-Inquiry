import { generateClient } from "aws-amplify/data";

let client;

// Amplify.configure() runs once in main.jsx; this client reuses that configuration
// and signs requests with the signed-in Cognito user-pool session.
export function getDataClient() {
  if (!client) client = generateClient({ authMode: "userPool" });
  return client;
}

export const CLOUD_MODELS = ["Publication", "ResearchProject", "ProfileContent"];

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

function modelFor(modelName) {
  const model = getDataClient().models[modelName];
  if (!model) throw new Error(`Model ${modelName} is missing from the Amplify configuration.`);
  return model;
}

// Read-only: returns the full record, or null when no record has this id.
export async function getCloudRecord(modelName, id) {
  const { data, errors } = await modelFor(modelName).get({ id });
  if (errors?.length) throw new Error(errors.map((error) => error.message).join("; "));
  return data ?? null;
}

// Create-only. Amplify Data creates use a "must not already exist" condition, so this can
// never overwrite an existing record.
export async function createCloudRecord(modelName, input) {
  const { data, errors } = await modelFor(modelName).create(input);
  if (errors?.length) throw new Error(errors.map((error) => error.message).join("; "));
  if (!data) throw new Error("The create call returned no record.");
  return data;
}

// Updates the record named by input.id with only the fields present in input. This call is
// unconditional on the server: callers must check for concurrent changes first (see cloud-writes.js).
export async function updateCloudRecord(modelName, input) {
  if (!input?.id) throw new Error("An update requires a record id.");
  const { data, errors } = await modelFor(modelName).update(input);
  if (errors?.length) throw new Error(errors.map((error) => error.message).join("; "));
  if (!data) throw new Error("The update call returned no record.");
  return data;
}

// Deletes one record by id. Also unconditional on the server; see cloud-writes.js for the pre-check.
export async function deleteCloudRecord(modelName, id) {
  if (!id) throw new Error("A delete requires a record id.");
  const { data, errors } = await modelFor(modelName).delete({ id });
  if (errors?.length) throw new Error(errors.map((error) => error.message).join("; "));
  return data ?? null;
}

// Read-only: lists every record with all fields, following pagination. Throws instead of
// returning a partial list so a preview can never treat an incomplete read as complete.
export async function listAllRecords(modelName) {
  const model = getDataClient().models[modelName];
  if (!model) throw new Error(`Model ${modelName} is missing from the Amplify configuration.`);

  const records = [];
  let pages = 0;
  let nextToken = null;

  do {
    const { data, errors, nextToken: token } = await model.list({ limit: PAGE_SIZE, nextToken });
    if (errors?.length) throw new Error(errors.map((error) => error.message).join("; "));
    records.push(...data);
    nextToken = token || null;
    pages += 1;
  } while (nextToken && pages < MAX_PAGES);

  if (nextToken) throw new Error(`${modelName} has more than ${MAX_PAGES * PAGE_SIZE} records; the preview stopped to avoid a partial comparison.`);
  return records;
}

// Read-only: only issues list queries and requests the id field, so no content is transferred.
export async function countModelRecords(modelName) {
  const model = getDataClient().models[modelName];
  if (!model) throw new Error(`Model ${modelName} is missing from the Amplify configuration.`);

  let total = 0;
  let pages = 0;
  let nextToken = null;

  do {
    const { data, errors, nextToken: token } = await model.list({
      selectionSet: ["id"],
      limit: PAGE_SIZE,
      nextToken
    });
    if (errors?.length) throw new Error(errors.map((error) => error.message).join("; "));
    total += data.length;
    nextToken = token || null;
    pages += 1;
  } while (nextToken && pages < MAX_PAGES);

  return { total, pages, truncated: Boolean(nextToken) };
}
