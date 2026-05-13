import type { SafeHtml } from 'kerfjs';

import { IconDownload } from '../../icons.js';
import type { Tab, TabContext } from './tabContext.js';

function renderUpdatesTab(): SafeHtml {
  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <span className="settings-heading">Software Updates</span>
      </div>
      <p className="settings-disclaimer">Check for new versions of the Glassbox desktop app.</p>
      <button className="btn btn-sm" id="check-updates-btn">Check for Updates</button>
      <p className="settings-hint" id="check-updates-status"></p>
    </div>
  );
}

export const updatesTab: Tab = {
  id: 'updates',
  label: 'Updates',
  icon: <IconDownload />,
  enabled: (ctx: TabContext) => ctx.isTauri,
  render: renderUpdatesTab,
};
