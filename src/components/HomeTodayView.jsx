import React from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  Flame,
  GraduationCap,
  Headphones,
  Layers,
  MessageCircle,
  MoreHorizontal,
  Settings,
  Search,
  Sparkles,
  Timer,
} from 'lucide-react';
import { ApiKeyNotice } from './ui/ApiKeyNotice';

const taskIcons = { vocab: Layers, oral: MessageCircle, reader: BookOpen };
const modules = [
  {
    id: 'vocab',
    title: '记住新单词',
    subtitle: '分类词卡 · 每次一点',
    icon: Layers,
    tone: 'blue',
  },
  {
    id: 'reader',
    title: '读懂好文章',
    subtitle: '中英伴读 · 随读随记',
    icon: BookOpen,
    tone: 'peach',
  },
  {
    id: 'oral',
    title: '大胆开口说',
    subtitle: '场景对话 · 轻松练习',
    icon: MessageCircle,
    tone: 'mint',
  },
  {
    id: 'grammar',
    title: '搭好句子骨架',
    subtitle: '语法讲解 · 动手造句',
    icon: Sparkles,
    tone: 'lilac',
  },
];

export default function HomeTodayView({
  snapshot,
  plan,
  weekly,
  greeting,
  remainingTasks,
  completedCount,
  deferredCount,
  dayIsFinished,
  usingSampleData,
  showDemoNotice,
  hasKey,
  showWeekly,
  setShowWeekly,
  showDuration,
  setShowDuration,
  updateDuration,
  openTask,
  markTask,
  onNavigate,
  dismissDemoNotice,
  startWithMyOwnDeck,
  refresh,
}) {
  const nextTask = plan.tasks.find((task) => !task.done && !task.deferred);
  const progress = plan.totalCount ? completedCount / plan.totalCount : 0;
  const date = new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());
  return (
    <section className="study-page home-page h-full overflow-y-auto">
      <div className="today-layout">
        <header className="today-heading">
          <div className="today-date">
            <span>{date}</span>
            <span className="today-streak">
              <Flame size={14} />
              连续 {snapshot.stats.streakDays || 0} 天
            </span>
          </div>
          <div className="today-heading-row">
            <div>
              <h1>今天，学点新的。</h1>
              <p>{greeting}</p>
            </div>
            <button
              type="button"
              className="today-profile"
              aria-label="打开设置"
              onClick={() => onNavigate('settings')}
            >
              <Settings size={22} />
            </button>
          </div>
        </header>

        <button type="button" className="today-dictionary" onClick={() => onNavigate('dictionary')}>
          <Search size={19} /><span>查个单词，读懂新表达</span><span>英汉词典</span><ArrowRight size={16} />
        </button>

        <div className="today-overview" aria-label="学习概览">
          <div>
            <span className="overview-icon blue">
              <Layers size={18} />
            </span>
            <span>
              <strong>
                {snapshot.dueWords}
                <small> 词</small>
              </strong>
              <p>{usingSampleData ? '示例词到期' : '今日待复习'}</p>
            </span>
          </div>
          <div>
            <span className="overview-icon mint">
              <GraduationCap size={18} />
            </span>
            <span>
              <strong>
                {snapshot.course.reviewItems}
                <small> 项</small>
              </strong>
              <p>课程待复习</p>
            </span>
          </div>
          <div>
            <span className="overview-icon peach">
              <Timer size={18} />
            </span>
            <span>
              <strong>
                {plan.dailyMinutes}
                <small> 分钟</small>
              </strong>
              <p>每日小目标</p>
            </span>
          </div>
        </div>

        <section className="today-focus" aria-label="下一步学习">
          <div className="focus-copy">
            <span className="focus-eyebrow">
              <span />
              {dayIsFinished ? '今日计划已完成' : 'YOUR DAILY FLOW'}
            </span>
            <h2>
              {nextTask?.title ||
                (deferredCount
                  ? '慢慢来，明天再继续'
                  : dayIsFinished
                    ? '今天的进步，值得庆祝'
                    : '从一小步开始')}
            </h2>
            <p>
              {nextTask?.description ||
                (deferredCount
                  ? `已完成 ${completedCount} 项，另有 ${deferredCount} 项推迟。`
                  : '去新概念或精读，发现一点新知识。')}
            </p>
            <button
              type="button"
              className="focus-start"
              onClick={() =>
                nextTask ? openTask(nextTask) : onNavigate('nce')
              }
            >
              <span>
                {nextTask
                  ? '开始这一小步'
                  : dayIsFinished
                    ? '再学一点'
                    : '去学新概念'}
              </span>
              <ArrowRight size={18} />
            </button>
            <span className="focus-minutes">
              {nextTask
                ? `约 ${nextTask.minutes} 分钟，轻松完成`
                : '按自己的节奏就好'}
            </span>
          </div>
          <div className="focus-ring">
            <svg
              viewBox="0 0 100 100"
              aria-labelledby="today-progress-title"
            >
              <title id="today-progress-title">{`今日计划已完成 ${completedCount} 项，共 ${plan.totalCount} 项`}</title>
              <circle cx="50" cy="50" r="43" className="ring-track" />
              <circle
                cx="50"
                cy="50"
                r="43"
                className="ring-value"
                strokeDasharray={`${progress * 270} 270`}
              />
            </svg>
            <div>
              <strong>
                {completedCount}
                <span>/{plan.totalCount}</span>
              </strong>
              <small>今日完成</small>
            </div>
            <span className="ring-spark">
              <Sparkles size={17} />
            </span>
          </div>
        </section>

        <section className="today-explore">
          <div className="today-section-title">
            <h2>换个方式学</h2>
            <span>找到你的学习节奏</span>
          </div>
          <div className="explore-grid">
            {modules.map(({ id, title, subtitle, icon: Icon, tone }) => (
              <button
                type="button"
                key={id}
                className={`explore-card ${tone}`}
                onClick={() =>
                  id === 'grammar'
                    ? onNavigate('vocab', { section: 'grammar' })
                    : onNavigate(id)
                }
              >
                <span className="explore-icon">
                  <Icon size={24} strokeWidth={1.8} />
                </span>
                <ArrowRight size={17} className="explore-arrow" />
                <strong>{title}</strong>
                <p>{subtitle}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="today-plan">
          <div className="today-section-title">
            <h2>今天的小目标</h2>
            <div className="duration-picker">
              <button
                type="button"
                aria-expanded={showDuration}
                onClick={() => setShowDuration(!showDuration)}
              >
                <Timer size={14} />
                {plan.dailyMinutes} 分钟
                <ChevronDown size={13} />
              </button>
              {showDuration && (
                <div className="duration-options">
                  {[10, 20, 30].map((minutes) => (
                    <button
                      type="button"
                      key={minutes}
                      aria-pressed={plan.dailyMinutes === minutes}
                      onClick={() => updateDuration(minutes)}
                    >
                      {minutes} 分钟
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="today-task-list">
            {plan.tasks.map((task, index) => {
              const Icon = taskIcons[task.type] || Headphones;
              return (
                <div
                  key={task.id}
                  className={`today-task ${task.done ? 'is-done' : task.deferred ? 'is-deferred' : ''}`}
                >
                  <span
                    className={`task-symbol ${task.type}`}
                    aria-hidden="true"
                  >
                    {task.done ? <Check size={20} /> : <Icon size={20} />}
                  </span>
                  <button
                    type="button"
                    className="task-label"
                    onClick={() => openTask(task)}
                  >
                    <span className="task-order">
                      {String(index + 1).padStart(2, '0')} ·{' '}
                      {task.done
                        ? '已完成'
                        : task.deferred
                          ? '已推迟'
                          : `约 ${task.minutes} 分钟`}
                    </span>
                    <strong>{task.title}</strong>
                    <p>{task.description}</p>
                  </button>
                  {task.done ? (
                    <Check size={18} className="task-done" />
                  ) : (
                    <div className="task-actions">
                      <button
                        type="button"
                        className="task-play"
                        aria-label={`开始：${task.title}`}
                        onClick={() => openTask(task)}
                      >
                        <ArrowRight size={18} />
                      </button>
                      <details className="task-more">
                        <summary aria-label={`更多操作：${task.title}`}>
                          <MoreHorizontal size={18} />
                        </summary>
                        <div>
                          <button
                            type="button"
                            aria-label={`稍后：${task.title}`}
                            onClick={(event) => {
                              markTask(task, 'deferred');
                              event.currentTarget.closest('details').open =
                                false;
                            }}
                          >
                            稍后学习
                          </button>
                          <button
                            type="button"
                            aria-label={`手动完成：${task.title}`}
                            onClick={(event) => {
                              markTask(task, 'completed');
                              event.currentTarget.closest('details').open =
                                false;
                            }}
                          >
                            手动完成
                          </button>
                        </div>
                      </details>
                    </div>
                  )}
                </div>
              );
            })}
            {plan.totalCount === 0 && (
              <p className="empty-plan">今天暂时没有安排，去开始一小步吧。</p>
            )}
          </div>
          <p className="plan-footnote">
            {remainingTasks
              ? `还有 ${remainingTasks} 项，按你的节奏来。`
              : dayIsFinished
                ? '今天已经完成，明天继续。'
                : `还有 ${deferredCount} 项推迟到明天。`}
          </p>
        </section>

        <section className="today-weekly">
          <button
            type="button"
            aria-expanded={showWeekly}
            className="weekly-toggle"
            onClick={() => setShowWeekly(!showWeekly)}
          >
            <span className="weekly-icon">
              <Flame size={21} />
            </span>
            <span>
              <strong>这一周的你</strong>
              <p>
                {weekly.activeDays} 天有学习 · {weekly.totalActions} 个学习动作
              </p>
            </span>
            <ChevronDown size={17} className={showWeekly ? 'is-open' : ''} />
          </button>
          {showWeekly && (
            <div className="weekly-content nce-reveal">
              <p>每天留下一点痕迹，比偶尔冲刺更有效</p>
              <div className="weekly-calendar" aria-label="近七天学习节奏">
                {weekly.activityCalendar.map((day) => (
                  <div
                    key={day.dateKey}
                    className={day.isToday ? 'is-today' : ''}
                  >
                    <span>周{day.weekday}</span>
                    <strong className={`activity-level-${day.level}`}>
                      {day.actions || '·'}
                    </strong>
                    <small>{day.day}</small>
                  </div>
                ))}
              </div>
              <div className="weekly-totals">
                {[
                  ['课程', weekly.courseSessions],
                  ['复习词', weekly.vocabReviews],
                  ['口语轮次', weekly.oralRounds],
                  ['精读摘录', weekly.readerNotes],
                ].map(([label, count]) => (
                  <div key={label}>
                    <strong>{count}</strong>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
              <p className="weekly-advice">{weekly.recommendation}</p>
              <small>
                {weekly.totalMinutes
                  ? `记录约 ${weekly.totalMinutes} 分钟`
                  : '从今天开始积累真实记录'}
              </small>
            </div>
          )}
        </section>

        <div className="today-notices">
          {showDemoNotice && usingSampleData && (
            <div className="today-demo">
              <strong>先用示例内容，试试手感</strong>
              <p>
                30 个演示生词和 8 篇示例文章供你体验，它们不是你的学习记录。
              </p>
              <div>
                <button type="button" onClick={dismissDemoNotice}>
                  先保留，我看看
                </button>
                <button type="button" onClick={startWithMyOwnDeck}>
                  清空示例，从零开始
                </button>
              </div>
            </div>
          )}
          {!hasKey && (
            <ApiKeyNotice onOpenSettings={() => onNavigate('settings')} />
          )}
          {snapshot.events.filter(
            (event) => event.at > (snapshot.appState.lastExportAt || 0),
          ).length >= 20 && (
            <button
              type="button"
              className="backup-reminder"
              onClick={() => onNavigate('settings')}
            >
              积累了新的学习记录，点此导出备份。
            </button>
          )}
        </div>
        <footer className="today-footer">
          <span>学习记录保存在这台设备上</span>
          <button type="button" onClick={refresh}>
            刷新计划
          </button>
        </footer>
      </div>
    </section>
  );
}
