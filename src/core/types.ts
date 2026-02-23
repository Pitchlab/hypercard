export interface ICard {
  id: string;
  path: string;
  title: string;
  type: string;
  tags: string[];
  content: string;
  frontmatter: Record<string, unknown>;
  mtime: number;
}

export interface IEdge {
  source_id: string;
  target_id: string;
  context: string;
  position: number;
}

export interface IParsedLink {
  target_id: string;
  display_text?: string;
  context: string;
  position: number;
}

export interface ICardWithLinks extends ICard {
  links_out: string[];
  links_in: string[];
}

export interface ICardListEntry {
  id: string;
  title: string;
  type: string;
  tags: string[];
  links_out: number;
  links_in: number;
}

export interface ISearchResult {
  id: string;
  title: string;
  type: string;
  tags: string[];
  score: number;
  snippet: string;
  bm25_rank?: number;
  vec_rank?: number;
}

export interface IConfig {
  root: string;
  daemon: {
    idle_timeout: number;
    debounce: number;
    socket: string;
  };
  watch: {
    include: string[];
    exclude: string[];
  };
  index: {
    max_content_length: number;
  };
}

export interface IIndexStats {
  cards_added: number;
  cards_updated: number;
  cards_deleted: number;
  edges: number;
}

export interface IStaleCheck {
  stale: string[];
  missing: string[];
  new_files: string[];
}

export interface IFuzzyMatch {
  id: string;
  score: number;
}

export interface IInitSummary {
  initialized: boolean;
  root: string;
  cards: number;
  types: string[];
  links: number;
  broken_links: number;
}
