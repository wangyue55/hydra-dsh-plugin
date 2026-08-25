/** Intranet wiki domain types shared by the client and the tool consumers. @module @hydra-dsh/plugin-intranet-wiki/src/types */

/** Resolved Confluence-style REST endpoint: base URL without a trailing slash plus a bearer token. */
export interface WikiEndpoint {
  /** API origin plus context path, no trailing slash. */
  baseUrl: string
  /** Bearer token sent as `Authorization: Bearer <token>`. */
  token: string
}

/** One wiki page with its storage-format body. */
export interface WikiPage {
  /** Numeric content id as a string. */
  pageId: string
  /** Page title. */
  title: string
  /** Browser URL of the page; empty when the API returned no web link. */
  url: string
  /** Version number; absent when the API omitted it. */
  version?: number | undefined
  /** Space key owning the page; absent when the API omitted it. */
  spaceKey?: string | undefined
  /** Storage- or view-format HTML body. */
  html: string
}

/** One discovered descendant page without its body. */
export interface WikiPageSummary {
  /** Numeric content id as a string. */
  pageId: string
  /** Parent page id this summary was discovered under. */
  parentPageId: string
  /** Depth below the walk root; direct children are depth 1. */
  depth: number
  /** Page title. */
  title: string
  /** Browser URL of the page; empty when the API returned no web link. */
  url: string
  /** Version number; absent when the API omitted it. */
  version?: number | undefined
}

/** Breadth-first descendant listing with its truncation state. */
export interface WikiPageTree {
  /** Discovered pages in breadth-first order, root excluded. */
  pages: WikiPageSummary[]
  /** Whether depth, page, or child-listing failures cut the walk short. */
  truncated: boolean
  /** Human-readable walk diagnostics, one entry per problem. */
  warnings: string[]
}
