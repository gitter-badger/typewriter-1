import EventDispatcher from './eventdispatcher';
import Editor from './editor';
import { render } from './view/vdom';
import defaultPaper from './view/defaultPaper';
import { getSelection, setSelection, getBrowserRange, getNodeAndOffset, getNodeIndex } from './selection';
import { deltaToVdom, deltaFromDom, deltaToHTML, deltaFromHTML } from './view/dom';
import Paper from './paper';
import shortcuts from 'shortcut-string';
import { shallowEqual } from 'fast-equals';
import diff from 'fast-diff';

const SOURCE_API = 'api';
const SOURCE_USER = 'user';
const SOURCE_SILENT = 'silent';
const isMac = navigator.userAgent.indexOf('Macintosh') !== -1;
const modExpr = /Ctrl|Cmd/;


export default class View extends EventDispatcher {

  constructor(editor, options = {}) {
    super();
    if (!editor) throw new Error('Editor view requires an editor');
    this.editor = editor;
    this.root = document.createElement('div');
    this.paper = new Paper(options.paper || defaultPaper);
    this.enabled = true;
    this.isMac = isMac;
    this._settingEditorSelection = false;
    this._settingBrowserSelection = false;

    if (options.modules) options.modules.forEach(module => module(this));
  }

  hasFocus() {
    return this.root.contains(this.root.ownerDocument.activeElement);
  }

  focus() {
    if (this.lastSelection) this.editor.setSelection(this.lastSelection);
    else this.root.focus();
  }

  blur() {
    this.root.blur();
  }

  disable() {
    this.enable(false);
  }

  enable(enabled = true) {
    this.enabled = enabled;
    this.update();
  }

  getBounds(from, to) {
    const range = this.editor._normalizeArguments(from, to);
    const browserRange = getBrowserRange(this, range);
    if (browserRange.endContainer.nodeType === Node.ELEMENT_NODE) {
      browserRange.setEnd(browserRange.endContainer, browserRange.endOffset + 1);
    }
    return browserRange.getBoundingClientRect();
  }

  getAllBounds(from, to) {
    const range = this.editor._normalizeArguments(from, to);
    const browserRange = getBrowserRange(this, range);
    if (browserRange.endContainer.nodeType === Node.ELEMENT_NODE) {
      browserRange.setEnd(browserRange.endContainer, browserRange.endOffset + 1);
    }
    return browserRange.getClientRects();
  }

  getHTML() {
    return deltaToHTML(this, this.editor.contents);
  }

  setHTML(html, source) {
    this.editor.setContents(deltaFromHTML(this, html), source);
  }

  update(changeEvent) {
    let contents = this.editor.contents;
    this.decorations = this.editor.getChange(() => this.fire('decorate', this.editor, changeEvent));
    if (this.decorations.ops.length) {
      contents = contents.compose(this.decorations);
      this.reverseDecorations = contents.diff(this.editor.contents);
    } else {
      this.reverseDecorations = this.decorations;
    }
    const vdom = deltaToVdom(this, contents);
    if (!this.enabled) vdom.attributes.contenteditable = undefined;
    this.pauseObserver();
    this.root = render(vdom, this.root);
    this.resumeObserver();
    this.updateBrowserSelection();
    this.fire('update', changeEvent);
  }

  updateBrowserSelection() {
    if (this._settingEditorSelection) return;
    this._settingBrowserSelection = true;
    this.setSelection(this.editor.selection);
    setTimeout(() => this._settingBrowserSelection = false, 20);
  }

  updateEditorSelection() {
    if (this._settingBrowserSelection) return this._settingBrowserSelection = false;
    const range = this.getSelection();

    // Store the last non-null selection for restoration on focus()
    if (range) this.lastSelection = range;

    this._settingEditorSelection = true;
    this.editor.setSelection(range);
    this._settingEditorSelection = false;

    // If the selection was adjusted when set then update the browser's selection
    if (!shallowEqual(range, this.editor.selection)) this.updateBrowserSelection();
  }

  getSelection() {
    let range = getSelection(this);
    if (range && this.reverseDecorations.ops.length) {
      range = range.map(i => this.reverseDecorations.transform(i));
    }
    return range;
  }

  setSelection(range) {
    if (range && this.decorations.ops.length) {
      range = range.map(i => this.decorations.transform(i));
    }
    setSelection(this, range);
  }

  mount(container) {
    container.appendChild(this.root);
    this.root.ownerDocument.execCommand('defaultParagraphSeparator', false, 'p');

    const onKeyDown = event => {
      let shortcut = shortcuts.fromEvent(event);
      this.fire(`shortcut:${shortcut}`, event, shortcut);
      this.fire(`shortcut`, event, shortcut);
      if (modExpr.test(shortcut)) {
        shortcut = shortcut.replace(modExpr, 'Mod');
        this.fire(`shortcut:${shortcut}`, event, shortcut);
        this.fire(`shortcut`, event, shortcut);
      }
    };

    const onSelectionChange = () => {
      this.updateEditorSelection();
    };

    this.root.addEventListener('keydown', onKeyDown);
    container.ownerDocument.addEventListener('selectionchange', onSelectionChange);

    const observer = new MutationObserver(list => {
      const seen = new Set();
      list = list.filter(m => {
        if (seen.has(m.target)) return false;
        seen.add(m.target);
        return true;
      });

      const selection = this.getSelection();
      const mutation = list[0];
      const isTextChange = list.length === 1 && mutation.type === 'characterData' ||
        (mutation.type === 'childList' && mutation.addedNodes.length === 1 &&
         mutation.addedNodes[0].nodeType === Node.TEXT_NODE);

      // Only one text node has been altered. Optimize for this most common case.
      if (isTextChange) {
        const change = this.editor.delta();
        let index = getNodeIndex(this, mutation.target);
        index = this.reverseDecorations.transform(index);
        change.retain(index);
        if (mutation.type === 'characterData') {
          const diffs = diff(mutation.oldValue.replace(/\xA0/g, ' '), mutation.target.nodeValue.replace(/\xA0/g, ' '));
          diffs.forEach(([ action, string ]) => {
            if (action === diff.EQUAL) change.retain(string.length);
            else if (action === diff.DELETE) change.delete(string.length);
            else if (action === diff.INSERT) {
              change.insert(string, editor.activeFormats);
            }
          });
          change.chop();
        } else {
          change.insert(mutation.addedNodes[0].nodeValue.replace(/\xA0/g, ' '), editor.activeFormats);
        }

        if (change.ops.length) {
          // console.log('changing a little', change);
          editor.updateContents(change, SOURCE_USER, selection);
        }
      } else if (list.length === 1 && mutation.type === 'childList' &&
        addedNodes.length === 1 && mutation.addedNodes[0].nodeType === Node.TEXT_NODE)
      {

      } else {
        let contents = deltaFromDom(this, this.root);
        contents = contents.compose(this.reverseDecorations);
        const change = this.editor.contents.diff(contents);
        // console.log('changing a lot (possibly)', change);
        editor.updateContents(change, SOURCE_USER, selection);
      }
    });

    const opts = { characterData: true, characterDataOldValue: true, subtree: true,childList: true, attributes: true };
    this.resumeObserver = () => observer.observe(this.root, opts);
    this.pauseObserver = () => observer.disconnect();
    this.resumeObserver();


    // Use mutation tracking during development to catch errors
    // TODO delete mutation observer
    let checking = 0;
    const devObserver = new MutationObserver(list => {
      if (checking) clearTimeout(checking);
      checking = setTimeout(() => {
        checking = 0;
        const diff = editor.contents.compose(this.decorations).diff(deltaFromDom(view));
        if (diff.length()) {
          console.error('Delta out of sync with DOM:', diff);
        }
      }, 20);
    });
    devObserver.observe(this.root, { characterData: true, characterDataOldValue: true, childList: true, attributes: true, subtree: true });

    this.editor.on('text-changing', event => this._preventIncorrectFormats(event));
    this.editor.on('text-change', event => this.update(event));
    this.editor.on('selection-change', () => this.updateBrowserSelection());
    this.update();

    this.unmount = () => {
      devObserver.disconnect();
      observer.disconnect();
      this.root.removeEventListener('keydown', onKeyDown);
      this.root.ownerDocument.removeEventListener('selectionchange', onSelectionChange);
      this.root.remove();
      this.unmount = () => {};
    }
  }

  unmount() {}


  _preventIncorrectFormats({ change }) {
    return !change.ops.some(op => {
      if (typeof op.insert === 'object') {
        return !this.paper.embeds.find(op.insert);
      } else if (op.attributes) {
        return !(this.paper.blocks.find(op.attributes) || this.paper.markups.find(op.attributes));
      }
    });
  }

}
