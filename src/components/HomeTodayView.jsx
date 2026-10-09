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

const taskIcons = { vocab: Layers, oral: MessageCircle, reader: BookOpen };
const modules = [
  {
    id: 'vocab',
    title: '闪卡复习',
    icon: Layers,
    tone: 'blue',
  },
  {
    id: 'reader',
    title: '精读',
    icon: BookOpen,
    tone: 'peach',
  },
  {
    id: 'oral',
    title: '口语',
    icon: MessageCircle,
    tone: 'mint',
  },
  {
    id: 'grammar',
    title: '语法',
    icon: Sparkles,
    tone: 'lilac',
  },
];

export default function HomeTodayView({
  snapshot,
  plan,
  weekly,
  completedCount,
  deferredCount,
  dayIsFinished,
  usingSampleData,
  showDemoNotice,
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
              <h1>今日学习</h1>
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

        {showDemoNotice && usingSampleData && (
          <div className="today-demo today-demo-intro">
            <strong>正在体验示例内容</strong>
            <div>
              <button type="button" onClick={dismissDemoNotice}>继续体验</button>
              <button type="button" onClick={startWithMyOwnDeck}>移除演示生词</button>
            </div>
          </div>
        )}

        <button type="button" className="today-dictionary" onClick={() => onNavigate('dictionary')}>
          <Search size={19} /><span>查词</span><ArrowRight size={16} />
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
              <p>每日目标</p>
            </span>
          </div>
        </div>

        <section className="today-focus" aria-label="下一步学习">
          <div className="focus-copy">
            <h2>
              {nextTask?.title ||
                (deferredCount
                  ? '剩余任务已推迟'
                  : dayIsFinished
                    ? '今日计划已完成'
                    : '开始学习')}
            </h2>
            <button
              type="button"
              className="focus-start"
              onClick={() =>
                nextTask ? openTask(nextTask) : onNavigate('nce')
              }
            >
              <span>
                {nextTask
                  ? '开始学习'
                  : dayIsFinished
                    ? '再学一点'
                    : '去学新概念'}
              </span>
              <ArrowRight size={18} />
            </button>
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

        <section className="today-plan">
          <div className="today-section-title">
            <h2>今日任务</h2>
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
            {plan.tasks.filter((task) => task.id !== nextTask?.id).map((task, index) => {
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
              <p className="empty-plan">暂无任务</p>
            )}
          </div>
        </section>

        <section className="today-explore">
          <div className="today-section-title">
            <h2>学习工具</h2>
          </div>
          <div className="explore-grid">
            {modules.map(({ id, title, icon: Icon, tone }) => (
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
              </button>
            ))}
          </div>
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
              <strong>本周记录</strong>
              <p>
                {weekly.activeDays} 天有学习 · {weekly.totalActions} 个学习动作
              </p>
            </span>
            <ChevronDown size={17} className={showWeekly ? 'is-open' : ''} />
          </button>
          {showWeekly && (
            <div className="weekly-content nce-reveal">
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
              {weekly.totalMinutes > 0 && <span>{weekly.totalMinutes} 分钟</span>}
            </div>
          )}
        </section>

        <div className="today-notices">
          {snapshot.events.filter(
            (event) => event.at > (snapshot.appState.lastExportAt || 0),
          ).length >= 20 && (
            <button
              type="button"
              className="backup-reminder"
              onClick={() => onNavigate('settings')}
            >
              备份学习记录
            </button>
          )}
        </div>
        <footer className="today-footer">
          <button type="button" onClick={refresh}>
            刷新计划
          </button>
        </footer>
      </div>
    </section>
  );
}
