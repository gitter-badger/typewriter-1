import Editor from './editor';
import View from './view';

import input from './modules/input';
import keyShortcuts from './modules/key-shortcuts';
import history from './modules/history';
import placeholder from './modules/placeholder';
import smartEntry from './modules/smart-entry';
import smartQuotes from './modules/smart-quotes';

const defaultViewModules = [ input, keyShortcuts, history ];

export { Editor, View, input, keyShortcuts, history, placeholder, smartEntry, smartQuotes, defaultViewModules };
