/**
 * Gate packets rendered from markdown (spec 2.3).
 *
 * Two rules matter here. Raw HTML is never rendered, because a packet is
 * written by an agent. And a link either names a file in the repository, in
 * which case it opens in the in-app viewer, or it is not a link at all: the
 * app never hands an href to the operating system.
 */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Matches any URI scheme, including a bare Windows drive letter. */
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** True when an href names a path inside the repository rather than a location. */
export function isLocalPath(href: string): boolean {
  if (!href) return false;
  if (href.startsWith('#')) return false; // in-document anchor, handled by the index
  if (href.startsWith('//')) return false; // protocol-relative, so remote
  if (href.includes('\\')) return false; // a Windows absolute path, not a repo path
  if (HAS_SCHEME.test(href)) return false;
  return true;
}

/** Heading slug in GitHub's style, so the packet index can scroll to a section. */
export function slugify(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s/g, '-');
}

export interface MarkdownProps {
  source: string;
  /** Called when a reader clicks a link that names a file in the repository. */
  onOpenPath?: (path: string) => void;
  className?: string;
}

function headingText(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(headingText).join('');
  if (children && typeof children === 'object' && 'props' in (children as never)) {
    return headingText((children as { props: { children?: React.ReactNode } }).props.children);
  }
  return '';
}

export function Markdown({ source, onOpenPath, className }: MarkdownProps) {
  return (
    <div className={className ? `md ${className}` : 'md'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 id={slugify(headingText(children))}>{children}</h1>,
          h2: ({ children }) => <h2 id={slugify(headingText(children))}>{children}</h2>,
          h3: ({ children }) => <h3 id={slugify(headingText(children))}>{children}</h3>,
          a: ({ href, children }) => {
            const target = href ?? '';
            if (isLocalPath(target) && onOpenPath) {
              return (
                <button
                  type="button"
                  className="md-path"
                  onClick={() => onOpenPath(target)}
                  title={`Open ${target}`}
                >
                  {children}
                </button>
              );
            }
            // Anchors stay live for the section index; everything else is inert
            // text, because nothing in a packet should reach the outside world.
            if (target.startsWith('#')) return <a href={target}>{children}</a>;
            return <span className="md-inert" title={target}>{children}</span>;
          },
          table: ({ children }) => (
            <div className="md-table-wrap">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
