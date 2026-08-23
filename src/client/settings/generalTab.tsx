import type { SafeHtml } from 'kerfjs';

import { IconSliders } from '../../icons.js';
import type { Tab, TabContext } from './tabContext.js';

function renderDifftoolSection(ctx: TabContext): SafeHtml {
  const { difftoolStatus } = ctx;
  const isRegistered = difftoolStatus.isGlassbox;
  const conflictTool = !isRegistered && difftoolStatus.tool !== null ? difftoolStatus.tool : null;
  return (
    <div className="settings-section">
      <label className="settings-label">Git difftool</label>
      {isRegistered ? (
        <div className="settings-difftool-row">
          <span className="settings-difftool-status settings-difftool-status--ok">
            Registered as your global <code>git difftool</code>.
          </span>
          <div className="settings-difftool-actions">
            <button className="btn btn-sm" id="difftool-register-btn">Re-register</button>
            <button className="btn btn-sm" id="difftool-unregister-btn">Unregister</button>
          </div>
        </div>
      ) : (
        <div className="settings-difftool-row">
          <span className="settings-difftool-status">
            {conflictTool !== null
              ? <>You currently have <code>{conflictTool}</code> set as your git difftool.</>
              : <>Not registered.</>}
          </span>
          <div className="settings-difftool-actions">
            <button className="btn btn-sm" id="difftool-register-btn">Set Glassbox as git difftool</button>
          </div>
        </div>
      )}
      <p className="settings-hint">
        Lets you run <code>git difftool --dir-diff &lt;range&gt;</code> from any repo and review the change set in Glassbox.
        {conflictTool !== null ? <> This updates your Git <code>diff.tool</code> setting; you can unregister anytime.</> : null}
      </p>
    </div>
  );
}

/** Human-readable byte size — these are whole data directories, so MB/GB. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : String(Math.round(value))} ${units[unit]}`;
}

/**
 * Retained pre-upgrade database backups (doc 9 §9.1a).
 *
 * Rendered only when one exists — most users never upgrade across a Postgres
 * major, and an always-present "no backups" row would be noise. The app keeps
 * the copy indefinitely and never deletes it on its own, which is the right
 * default for the user's only fallback but leaves a full-size duplicate on
 * disk; this section is how they find it and reclaim the space deliberately.
 */
function renderBackupsSection(ctx: TabContext): SafeHtml {
  const { dbBackups } = ctx;
  if (dbBackups.length === 0) return <></>;
  return (
    <>
      <div className="settings-divider"></div>
      <div className="settings-section">
        <label className="settings-label">Database backups</label>
        {dbBackups.map(b => (
          <div className="settings-backup-row" data-key={b.name}>
            <div className="settings-backup-info">
              <span className="settings-backup-size">{formatBytes(b.bytes)}</span>
              <span className="settings-backup-date">
                {b.createdAt !== null
                  ? `Saved ${new Date(b.createdAt).toLocaleDateString()}`
                  : 'Saved before a database upgrade'}
              </span>
              <code className="settings-backup-path">{b.path}</code>
            </div>
            <button className="btn btn-sm btn-danger" data-delete-backup={b.name}>Delete</button>
          </div>
        ))}
        <p className="settings-hint">
          A copy of your review database kept from before a PostgreSQL version upgrade. Everything
          in it was carried over, so this is only a fallback — safe to delete once you're satisfied
          your reviews are intact.
        </p>
      </div>
    </>
  );
}

/**
 * Quarantined directories the corrupt-database recovery set aside (doc 9 §9.5).
 *
 * Listed separately from the backups above, with no Delete. The distinction is
 * the point: a backup is redundant by construction, whereas this is data
 * Glassbox could not read and may be the user's only copy. Offering the same
 * one-click delete would flatten that difference, so the only action here is to
 * reveal it in the file manager — an invitation to try to recover it, not to
 * discard it.
 */
function renderQuarantinedSection(ctx: TabContext): SafeHtml {
  const { dbQuarantined } = ctx;
  if (dbQuarantined.length === 0) return <></>;
  return (
    <>
      <div className="settings-divider"></div>
      <div className="settings-section">
        <label className="settings-label">Preserved unreadable data</label>
        {dbQuarantined.map(d => (
          <div className="settings-backup-row" data-key={d.name}>
            <div className="settings-backup-info">
              <span className="settings-backup-size">{formatBytes(d.bytes)}</span>
              <span className="settings-backup-date">
                {d.createdAt !== null
                  ? `Set aside ${new Date(d.createdAt).toLocaleDateString()}`
                  : 'Set aside after a failed startup'}
              </span>
              <code className="settings-backup-path">{d.path}</code>
            </div>
            <button className="btn btn-sm" data-reveal-backup={d.name}>Reveal</button>
          </div>
        ))}
        <p className="settings-hint">
          A database Glassbox could not open. It was kept rather than deleted, because it may hold
          reviews that exist nowhere else. Glassbox won't remove it — open it in your file manager
          if you want to try recovering it, or delete it yourself once you're sure you don't need it.
        </p>
      </div>
    </>
  );
}

function renderGeneralTab(ctx: TabContext): SafeHtml {
  const { themesData, activeThemeId, appName, isTauri } = ctx;
  return (
    <>
      <div className="settings-section">
        <label className="settings-label">Theme</label>
        <div className="settings-theme-row">
          <select className="settings-select" id="settings-theme">
            {themesData.themes.filter(t => t.builtIn).map(t =>
              <option value={t.id} selected={t.id === activeThemeId}>{t.name}</option>
            )}
            {themesData.themes.some(t => !t.builtIn) && (
              <>
                <option disabled>{'─'.repeat(20)}</option>
                {themesData.themes.filter(t => !t.builtIn).map(t =>
                  <option value={t.id} selected={t.id === activeThemeId}>{t.name}</option>
                )}
              </>
            )}
          </select>
          <button className="btn btn-sm" id="manage-themes-btn">Manage Themes</button>
        </div>
      </div>
      {isTauri && (
        <div className="settings-section">
          <label className="settings-label">App Name</label>
          <input type="text" className="settings-input" id="settings-app-name" value={appName} placeholder="Glassbox — project-name" />
          <p className="settings-hint">Custom window title for the desktop app. Leave blank for the default.</p>
        </div>
      )}
      <div className="settings-divider"></div>
      {renderDifftoolSection(ctx)}
      {renderBackupsSection(ctx)}
      {renderQuarantinedSection(ctx)}
      <div className="settings-divider"></div>
      <div className="settings-section">
        <a className="settings-share-link" id="settings-share-link" href="#">Know someone who'd love this? <strong>Share Glassbox</strong></a>
      </div>
    </>
  );
}

export const generalTab: Tab = {
  id: 'general',
  label: 'General',
  icon: <IconSliders />,
  render: renderGeneralTab,
};
