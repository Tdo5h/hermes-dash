/** SessionStorage bridge: reviewed Create brief → new creative_studio chat sends first turn. */
export const CREATIVE_STUDIO_DRAFT_INITIAL_KEY =
  "hermes-creative-studio-draft-initial";

export type CreativeStudioDraftInitialPayload = {
  sessionId: string;
  nonce: string;
  text: string;
};
