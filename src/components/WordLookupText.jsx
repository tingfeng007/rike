import React from 'react';
import { tokenizeLookupText } from '../services/wordTokens';
import { useWordLookup } from './wordLookupContext';

export default function WordLookupText({ text, context, contextCn, className = '', wordClassName = '', onBeforeLookup }) {
  const { openWordLookup } = useWordLookup();
  return <span className={className}>{tokenizeLookupText(text).map((token) => token.word ? (
    <button
      key={token.index}
      type="button"
      className={`lookup-word ${typeof wordClassName === 'function' ? wordClassName(token.word) : wordClassName}`}
      data-word-lookup="off"
      aria-label={`查词 ${token.text}`}
      onClick={(event) => {
        event.stopPropagation();
        const request = { word: token.word, context: context || text, contextCn };
        openWordLookup({ ...request, onBeforeLookup });
      }}
    >{token.text}</button>
  ) : <React.Fragment key={token.index}>{token.text}</React.Fragment>)}</span>;
}
