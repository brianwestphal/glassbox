import type { SafeHtml } from 'kerfjs';

import { IconUser } from '../../icons.js';
import type { Tab, TabContext } from './tabContext.js';

export const TOP_LANGUAGES: Array<[string, string]> = [
  ['javascript', 'JavaScript'], ['python', 'Python'], ['typescript', 'TypeScript'],
  ['java', 'Java'], ['csharp', 'C#'], ['cpp', 'C++'],
  ['go', 'Go'], ['rust', 'Rust'], ['php', 'PHP'], ['swift', 'Swift'],
];

export const MORE_LANGUAGES: Array<[string, string]> = [
  ['c', 'C'], ['ruby', 'Ruby'], ['kotlin', 'Kotlin'], ['scala', 'Scala'],
  ['dart', 'Dart'], ['objectivec', 'Objective-C'], ['elixir', 'Elixir'],
  ['haskell', 'Haskell'], ['clojure', 'Clojure'], ['bash', 'Shell'],
  ['perl', 'Perl'], ['lua', 'Lua'], ['r', 'R'], ['ocaml', 'OCaml'],
  ['zig', 'Zig'], ['nim', 'Nim'], ['erlang', 'Erlang'], ['groovy', 'Groovy'],
];

export const ALL_LANG_KEYS = new Set([...TOP_LANGUAGES, ...MORE_LANGUAGES].map(([k]) => k));

function renderTag(key: string, label: string, guidedTopics: Set<string>): SafeHtml {
  const active = guidedTopics.has(key);
  return <button className={`settings-tag${active ? ' active' : ''}`} data-topic={key}>{label}</button>;
}

function renderProfileTab(ctx: TabContext): SafeHtml {
  const { guidedTopics, showMoreLangs } = ctx;

  const langTags = TOP_LANGUAGES.map(([k, n]) => renderTag(k, n, guidedTopics));
  const moreLangTags = MORE_LANGUAGES.map(([k, n]) => renderTag(k, n, guidedTopics));

  return (
    <>
      <p className="settings-disclaimer">
        Tell us about your experience level so AI features can tailor explanations to you.
      </p>

      <div className="settings-guided-topics">
        <label className="settings-label">I'm new to...</label>
        <div className="settings-tags">
          {renderTag('programming', 'Programming', guidedTopics)}
          {renderTag('codebase', 'This codebase', guidedTopics)}
        </div>

        <label className="settings-label settings-label-spaced">I'm new to these languages</label>
        <div className="settings-tags">
          {langTags}
        </div>

        {!showMoreLangs && (
          <button className="settings-more-toggle" id="show-more-langs">More languages...</button>
        )}
        {showMoreLangs && (
          <div className="settings-tags settings-tags-more">
            {moreLangTags}
          </div>
        )}
      </div>
    </>
  );
}

export const profileTab: Tab = {
  id: 'profile',
  label: 'Profile',
  icon: <IconUser />,
  render: renderProfileTab,
};
