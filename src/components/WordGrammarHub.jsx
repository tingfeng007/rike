import React, { useEffect, useRef, useState } from 'react';
import { Layers, SpellCheck } from 'lucide-react';
import VocabularySRS from './VocabularySRS';
import GrammarLab from './GrammarLab';
import { SectionSwitch } from './ui/SectionSwitch';
import { StorageService } from '../services/storage';

/**
 * 「词法」板块：把「生词」与「语法」合并成一个底部导航项。
 *
 * 底部导航原本 6 项（首页 / 口语 / 精读 / 新概念 / 语法 / 生词），在 375px 宽的手机上过于拥挤。
 * 生词与语法都属于「语言知识积累」这一类，合并后导航回到 5 项，并且两个板块共用一级切换器，
 * 各自保留自己的二级标签（生词：闪卡 / 清单 / 测验；语法：讲解 / 练习 / 拆句）。
 *
 * `intent` 支持外部直接跳到某个板块（例如首页任务卡点「复习生词」时只切板块，不重新挂载）。
 */
export default function WordGrammarHub({ onOpenSource, onOpenSettings, intent = null }) {
  const [section, setSection] = useState(() => {
    const saved = StorageService.getAppState().wordGrammarSection;
    return saved === 'grammar' ? 'grammar' : 'vocab';
  });

  const changeSection = (next) => {
    if (next === section) return;
    setSection(next);
    StorageService.saveAppState({ ...StorageService.getAppState(), wordGrammarSection: next });
  };

  // 外部意图（如首页任务卡）可以指定要打开的板块；token 保证重复点击同样生效。
  const lastIntentRef = useRef(0);
  useEffect(() => {
    if (!intent?.token || !intent.section || lastIntentRef.current === intent.token) return;
    lastIntentRef.current = intent.token;
    changeSection(intent.section);
    // changeSection 只依赖当前 section，token 已保证一次性。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent?.token]);

  const sectionSwitch = (
    <SectionSwitch
      ariaLabel="生词与语法切换"
      value={section}
      onChange={changeSection}
      items={[
        { value: 'vocab', label: '生词复习', icon: Layers },
        { value: 'grammar', label: '语法实验室', icon: SpellCheck },
      ]}
    />
  );

  return (
    <div className="h-full min-h-0">
      {section === 'grammar' ? (
        <GrammarLab onOpenSettings={onOpenSettings} sectionSwitch={sectionSwitch} />
      ) : (
        <VocabularySRS onOpenSource={onOpenSource} sectionSwitch={sectionSwitch} />
      )}
    </div>
  );
}
