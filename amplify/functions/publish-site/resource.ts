import { defineFunction } from "@aws-amplify/backend";

// Lives in the "data" resource group: it reads the data API and is also the handler of a data
// mutation, which would otherwise create a circular stack dependency.
export const publishSite = defineFunction({
  name: "publish-site",
  entry: "./handler.ts",
  runtime: 22,
  timeoutSeconds: 60,
  memoryMB: 512,
  resourceGroupName: "data"
});
