export interface ICard {
  id: string;
  path: string;
  title: string;
  type: string;
  tags: string[];
  content: string;
  frontmatter: Record<string, unknown>;
  mtime: number;
  /**
   * Canonical timestamp (epoch ms) for the temporal layer. Derived at index
   * time from a frontmatter date field (date/created/published/...), falling
   * back to the file mtime. Drives --since/--until/--around queries.
   */
  timestamp: number;
  content_hash: string;
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
  /** Canonical timestamp (epoch ms) of the card — present on temporal queries. */
  timestamp?: number;
  /** Rank in the temporal-proximity dimension when fused via --around. */
  temporal_rank?: number;
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

export interface IIndexWarning {
  file: string;
  error: string;
}

export interface IIndexStats {
  cards_added: number;
  cards_updated: number;
  cards_deleted: number;
  edges: number;
  embeddings_generated?: number;
  embeddings_skipped?: number;
  warnings?: IIndexWarning[];
}

export type IProgressCallback = (phase: string, current: number, total: number) => void;

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

export interface ILinkChange {
  from: string;
  to: string;
}

export interface IFilenameIssue {
  issue: 'spaces_in_filename' | 'uppercase_in_filename' | 'no_type_directory';
  suggestion?: string;
}

export interface IConversionWarning {
  file: string;
  message: string;
}

export interface IConversionResult {
  file: string;
  converted_content: string;
  frontmatter_added: boolean;
  links_fixed: number;
  link_changes: ILinkChange[];
  filename_issues: IFilenameIssue[];
  warnings: IConversionWarning[];
  modified: boolean;
  /**
   * Single canonical rename target (relative path, with .md), computed in one
   * pass from all filename issues. Undefined when the filename is already clean.
   * The command performs exactly one rename to this path — never one per issue.
   */
  rename?: { from: string; to: string };
}

export interface IConversionSummary {
  dry_run: boolean;
  files_processed: number;
  files_modified: number;
  files_renamed: number;
  changes: {
    file: string;
    frontmatter_added: boolean;
    links_fixed: number;
    link_changes: ILinkChange[];
    filename_issues: IFilenameIssue[];
  }[];
  warnings: IConversionWarning[];
}
