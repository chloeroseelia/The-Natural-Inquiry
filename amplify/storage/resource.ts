import { defineStorage } from "@aws-amplify/backend";

export const storage = defineStorage({
  name: "naturalInquiryPrivateMedia",
  access: (allow) => ({
    "admin-media/*": [
      allow.groups(["Administrators"]).to(["read", "write", "delete"])
    ]
  })
});
