import { a, defineData, type ClientSchema } from "@aws-amplify/backend";

const schema = a.schema({
  Publication: a
    .model({
      title: a.string().required(),
      subtitle: a.string(),
      category: a.string().required(),
      summary: a.string(),
      content: a.string(),
      contentFormat: a.enum(["RICH_TEXT", "PDF"]),
      status: a.enum(["DRAFT", "IN_REVIEW", "APPROVED", "PUBLISHED", "ARCHIVED"]),
      archived: a.boolean(),
      indexCategories: a.json(),
      references: a.json(),
      mediaKeys: a.json(),
      sourceDocumentName: a.string(),
      publicPath: a.string(),
      publishedAt: a.datetime(),
      importedCreatedAt: a.datetime(),
      importedUpdatedAt: a.datetime(),
      revision: a.integer()
    })
    .authorization((allow) => allow.group("Administrators")),
  ResearchProject: a
    .model({
      title: a.string().required(),
      summary: a.string(),
      overview: a.string(),
      overviewTitle: a.string(),
      content: a.string(),
      projectNote: a.string(),
      projectStage: a.enum(["IN_PROGRESS", "PAST", "PLANNED"]),
      status: a.enum(["DRAFT", "IN_REVIEW", "APPROVED", "PUBLISHED", "ARCHIVED"]),
      indexCategories: a.json(),
      mediaKeys: a.json(),
      publicPath: a.string(),
      publishedAt: a.datetime(),
      importedCreatedAt: a.datetime(),
      importedUpdatedAt: a.datetime(),
      revision: a.integer()
    })
    .authorization((allow) => allow.group("Administrators")),
  ProfileContent: a
    .model({
      sectionKey: a.string().required(),
      title: a.string().required(),
      content: a.string(),
      summary: a.string(),
      status: a.enum(["DRAFT", "IN_REVIEW", "APPROVED", "PUBLISHED"]),
      sortOrder: a.integer(),
      publicPath: a.string(),
      publishedAt: a.datetime(),
      importedCreatedAt: a.datetime(),
      importedUpdatedAt: a.datetime(),
      revision: a.integer()
    })
    .authorization((allow) => allow.group("Administrators"))
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool"
  }
});
