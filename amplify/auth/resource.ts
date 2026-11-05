import { defineAuth } from "@aws-amplify/backend";

export const auth = defineAuth({
  loginWith: {
    email: true
  },
  groups: ["Administrators"],
  multifactor: {
    mode: "REQUIRED",
    totp: true
  }
});
