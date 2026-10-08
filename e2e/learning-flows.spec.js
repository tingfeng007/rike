import { test, expect } from '@playwright/test';

const mainNavigation = (page) => page.getByRole('navigation', { name: '主导航', exact: true });
const readStoredJSON = (page, key, fallback = null) => page.evaluate(({ key, fallback }) => {
  const value = localStorage.getItem(key);
  return value === null ? fallback : JSON.parse(value);
}, { key, fallback });

// Wait for the committed IDB record, rather than relying on rendering to prove a save.
async function readLearningSession(page, scope) {
  return page.evaluate((scope) => new Promise((resolve, reject) => {
    const request = indexedDB.open('lingoflow-learning');
    request.onupgradeneeded = () => request.transaction.abort();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Learning storage is blocked'));
    request.onsuccess = () => {
      const database = request.result;
      let transaction;
      try { transaction = database.transaction('learning', 'readonly'); }
      catch (error) { database.close(); reject(error); return; }
      const record = transaction.objectStore('learning').get('sessions');
      let result = null;
      record.onsuccess = () => { result = record.result?.[scope] || null; };
      transaction.oncomplete = () => { database.close(); resolve(result); };
      transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  }), scope);
}

test('free dictionary opens as a sheet and browser Back returns to the same module', async ({page}) => {
  await page.goto('/#/reader');
  await expect(page.getByRole('heading',{name:'精读伴读',exact:true})).toBeVisible();
  await mainNavigation(page).getByRole('button',{name:'词典',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'随手查词'});
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('英文单词或短语',{exact:true}).fill('coffee');
  await dialog.getByRole('button',{name:'查词',exact:true}).click();
  await expect(dialog.getByRole('heading',{name:'coffee',exact:true})).toBeVisible();
  await page.goBack();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/#\/reader(?:\?|$)/);
  await expect(page.getByRole('heading',{name:'精读伴读',exact:true})).toBeVisible();
});

test('category exploration survives reload without silently collecting cards', async ({page}) => {
  await page.goto('/#/vocab?section=vocab');
  await expect(page.getByLabel('选择词卡分类')).toBeVisible();
  const vocabularyBefore = await readStoredJSON(page, 'lingoflow_vocabulary');
  await page.getByLabel('选择词卡分类').selectOption('business');
  const front = page.locator('.flashcard-front');
  await expect(front).toBeVisible();
  const word = await front.locator('h2').textContent();
  await expect(page.getByRole('button',{name:'收藏本组',exact:true})).toBeVisible();
  await mainNavigation(page).getByRole('button',{name:'词典',exact:true}).click();
  await page.getByRole('dialog',{name:'随手查词'}).getByRole('button',{name:'关闭',exact:true}).click();
  await expect(front.locator('h2')).toHaveText(word);
  await expect.poll(async () => {
    const session = await readLearningSession(page, 'vocabulary');
    return session ? { category: session.selectedCategory, word: session.dueCards?.[session.currentIndex]?.word } : null;
  }).toEqual({ category: 'business', word });
  await page.reload();
  await expect(page.getByLabel('选择词卡分类')).toHaveValue('business');
  await expect(front.locator('h2')).toHaveText(word);
  await expect(page.locator('.flashcard-back')).toHaveAttribute('inert','');
  expect(await readStoredJSON(page, 'lingoflow_vocabulary')).toEqual(vocabularyBefore);
});

test('grammar deep link remains recoverable after reload', async ({page}) => {
  await page.goto('/#/vocab?section=grammar');
  await expect(page.getByRole('heading',{name:'语法实验室',exact:true})).toBeVisible();
  await expect(page.locator('.grammar-workbench')).toBeVisible();
  await expect(page.locator('body')).not.toContainText('这个页面刚刚卡住了');
  const sentence = 'I read a book quietly at home every evening.';
  await page.getByLabel('我的英文句子',{exact:true}).fill(sentence);
  await page.getByRole('checkbox',{name:'我能找到完整的主语和谓语',exact:true}).check();
  await page.getByRole('button',{name:'保存造句与自评',exact:true}).click();
  await expect(page.getByText('造句与自评已保存到本设备。',{exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading',{name:'语法实验室',exact:true})).toBeVisible();
  await expect(page.getByLabel('我的英文句子',{exact:true})).toHaveValue(sentence);
  await expect(page.getByRole('checkbox',{name:'我能找到完整的主语和谓语',exact:true})).toBeChecked();
  await expect(page.getByText('已保存造句 1 / 8 节',{exact:true})).toBeVisible();
});

test('a finished course advances recall and cannot repeatedly record the same completion', async ({page}) => {
  const filename = '001&002.Excuse Me';
  const lrc = '[00:01.00]Whose handbag is it?|这是谁的手提包？\n[00:02.00]Is this your handbag?|这是你的手提包吗？\n[00:03.00]Thank you very much.|非常感谢。';
  await page.route('https://nce.mleo.site/NCE1/**', async route => {
    const url = route.request().url();
    if (url.endsWith('/book.json')) await route.fulfill({json:{units:[{filename,title:'Excuse Me'}]}});
    else if (url.endsWith('.lrc')) await route.fulfill({body:lrc,contentType:'text/plain'});
    else await route.fulfill({status:404,body:''});
  });
  await page.goto('/#/nce');
  await page.getByRole('button',{name:/从第一课开始.*Excuse Me/}).click();
  await page.getByRole('button',{name:/04\s*练习\s*3\s*题/}).click();
  await page.getByRole('button',{name:'Whose',exact:true}).click();
  await page.getByRole('button',{name:'下一题',exact:true}).click();
  await page.getByPlaceholder('输入缺少的单词').fill('handbag');
  await page.getByRole('button',{name:'检查',exact:true}).click();
  await page.getByRole('button',{name:'下一题',exact:true}).click();
  await page.getByRole('button',{name:'Thank',exact:true}).click();
  await page.getByRole('button',{name:'完成练习',exact:true}).click();
  await expect(page.getByRole('heading',{name:'本课练习完成'})).toBeVisible();
  await expect(page.getByText('本次首答正确 3/3 题，复习得分已保存。')).toBeVisible();
  await page.getByRole('button',{name:'标记完成',exact:true}).click();
  await expect(page.getByRole('button',{name:'已完成本课',exact:true})).toBeDisabled();
  const beforeRecall = (await readStoredJSON(page, 'lingoflow_nce1_progress', {}))[filename];
  expect(beforeRecall.status).toBe('completed');
  expect(beforeRecall.completedCount).toBe(1);
  const recall = page.getByRole('button',{name:'完成本课回忆复习',exact:true});
  await expect(recall).toBeEnabled();
  await recall.click();
  await expect(recall).toBeDisabled();
  const afterRecall = (await readStoredJSON(page, 'lingoflow_nce1_progress', {}))[filename];
  expect(afterRecall.nextReviewAt).toBeGreaterThan(beforeRecall.nextReviewAt);
  expect(afterRecall.lastRecallScore).toBe(100);
  const activityCount = async (source) => (await readStoredJSON(page, 'lingoflow_study_events_v1', [])).filter((event) => event.source === source && event.entityId === filename).length;
  expect(await activityCount('nce-exercise')).toBe(1);
  expect(await activityCount('nce-lesson')).toBe(1);
  expect(await activityCount('nce-course-recall')).toBe(1);
  await page.reload();
  await expect(page.getByRole('heading',{name:'Excuse Me',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'已完成本课',exact:true})).toBeDisabled();
  await expect(recall).toBeDisabled();
  expect((await readStoredJSON(page, 'lingoflow_nce1_progress', {}))[filename].nextReviewAt).toBe(afterRecall.nextReviewAt);
  expect(await activityCount('nce-lesson')).toBe(1);
  expect(await activityCount('nce-course-recall')).toBe(1);
});

test('an empty backup does not bring demonstration vocabulary back', async ({page}) => {
  await page.goto('/#/settings');
  await expect(page.getByRole('heading',{name:'我的空间',exact:true})).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({name:'empty.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({app:'LingoFlow',version:4,vocabulary:[],articles:[]}))});
  const preview = page.getByRole('dialog',{name:'备份文件解析与合并预览',exact:true});
  await expect(preview).toBeVisible();
  await preview.getByRole('button',{name:'确认增量合并导入',exact:true}).click();
  await expect(preview).toBeHidden();
  expect(await readStoredJSON(page, 'lingoflow_vocabulary')).toEqual([]);
  await mainNavigation(page).getByRole('button',{name:'复习',exact:true}).click();
  await expect(page.locator('body')).not.toContainText('示例词到期');
  await expect(page.getByRole('button',{name:'添加词',exact:true})).toBeVisible();
  await expect(page.locator('.flashcard-front')).toHaveCount(0);
});

test.describe('installed offline shell', () => {
  test.use({serviceWorkers:'allow'});
  test('previously unvisited learning modules open offline after shell installation', async ({page,context}) => {
    await page.goto('/');
    // An active registration alone does not prove it controls this page. Polling
    // also gives precaching a bounded wait instead of hanging on ready forever.
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state || null), {timeout:30000}).toBe('activated');
    await context.setOffline(true);
    await page.goto('/#/vocab?section=grammar');
    await expect(page.getByRole('heading',{name:'语法实验室',exact:true})).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading',{name:'语法实验室',exact:true})).toBeVisible();
    await expect(mainNavigation(page).getByRole('button',{name:'词典',exact:true})).toBeVisible();
  });
});
