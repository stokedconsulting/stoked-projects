/* tslint:disable */
/* eslint-disable */
import "sst"
declare module "sst" {
  export interface Resource {
    MongoDBUri: {
      type: "sst.sst.Secret"
      value: string
    }
    ApiKeys: {
      type: "sst.sst.Secret"
      value: string
    }
  }
}
export {}
