import { Icon, PowerMark } from "./icons.jsx";
import { ModelSwitch } from "./ModelSwitch.jsx";

const NAV = [
  { id: "dashboard", label: "Dashboard", icon: "home" },
  { id: "courses", label: "Courses", icon: "book" },
  { id: "progress", label: "Progress", icon: "check" },
  { id: "lessons", label: "Lessons", icon: "calendar", disabled: true },
  { id: "assessments", label: "Assessments", icon: "clipboard", disabled: true },
  { id: "challenges", label: "Challenges", icon: "star", disabled: true },
  { id: "certification", label: "Completed", icon: "badge" },
  { id: "project", label: "Materials", icon: "folder" },
  { id: "download", label: "Download", icon: "download" },
];

const TOP = [
  { id: "courses", label: "Courses" },
  { id: "lessons", label: "Lessons", disabled: true },
  { id: "progress", label: "Progress" },
  { id: "project", label: "Materials" },
];

export function Shell({ panel, models, onSelectModel, query, onQuery, onNavigate, onUpload, children }) {
  return (
    <div className="shell">
      <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById("main-content")?.focus(); }}>Skip to content</a>
      <div className="board">
        <aside className="sidebar">
          <a className="logo" href="#/">
            <span className="logo-mark">
              <PowerMark />
            </span>
            <span className="logo-word">Professor</span>
          </a>
          <nav className="side-nav" aria-label="Dashboard">
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                className="side-link"
                disabled={item.disabled}
                title={item.disabled ? "Not available yet" : undefined}
                data-active={panel === item.id}
                aria-current={panel === item.id ? "page" : undefined}
                onClick={() => onNavigate(item.id)}
              >
                <Icon name={item.icon} size={18} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="premium">
            <span className="premium-icon">
              <Icon name="book" size={22} />
            </span>
            <p>Start a course from your own notes</p>
            <button type="button" className="ink-btn" onClick={onUpload}>
              Upload
            </button>
          </div>
        </aside>
        <div className="board-main">
          <header className="topbar">
            <nav className="top-links" aria-label="Sections">
              {TOP.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="top-link"
                  disabled={item.disabled}
                  title={item.disabled ? "Not available yet" : undefined}
                  data-active={panel === item.id}
                aria-current={panel === item.id ? "page" : undefined}
                  onClick={() => onNavigate(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
            <div className="top-tools">
              <button type="button" className="ink-btn top-upload" onClick={onUpload}>Upload</button>
              <label className="search">
                <Icon name="search" size={16} />
                <input
                  value={query}
                  placeholder="Search courses and PDFs…"
                  onChange={(event) => onQuery(event.target.value)}
                  aria-label="Search courses and PDFs"
                />
              </label>
              <ModelSwitch catalog={models} onSelect={onSelectModel} />
            </div>
          </header>
          <div className="board-body" id="main-content" tabIndex={-1}>{children}</div>
        </div>
      </div>
    </div>
  );
}
