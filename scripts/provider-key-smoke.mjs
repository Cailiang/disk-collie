import {acknowledgeMessage} from './message-smoke.mjs'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'

// Exercise the production Renderer, IPC, encrypted store and SDK against a
// loopback provider. Only synthetic credentials are used by this test.
export async function verifyProviderKeyEditing(page) {
  const requests = []
  let releaseDelayedModels
  let markDelayedRequested
  let markDelayedServed
  const delayedModels = new Promise((resolve) => { releaseDelayedModels = resolve })
  const delayedRequested = new Promise((resolve) => { markDelayedRequested = resolve })
  const delayedServed = new Promise((resolve) => { markDelayedServed = resolve })
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null
    requests.push({ path: request.url, authorization: request.headers.authorization })
    response.setHeader('content-type', 'application/json')
    if (request.url === '/v1/models') {
      const delayed = request.headers.authorization === 'Bearer smoke-delayed-5555'
      if (delayed) {
        markDelayedRequested()
        await delayedModels
      }
      response.end(JSON.stringify({ data: [{ id: delayed ? 'stale-model' : 'smoke-model' }] }), () => {
        if (delayed) markDelayedServed()
      })
      return
    }
    if (request.headers.authorization === 'Bearer smoke-invalid-3333') {
      response.writeHead(401)
      response.end(JSON.stringify({ error: { message: 'Synthetic invalid credential' } }))
      return
    }
    const probe = body?.tools?.some((item) => item.function?.name === 'connection_probe') &&
      !body.messages.some((item) => item.role === 'tool')
    response.end(JSON.stringify({
      id: 'smoke-response', object: 'chat.completion', created: 1, model: 'smoke-model',
      choices: [{ index: 0, finish_reason: probe ? 'tool_calls' : 'stop', message: probe
        ? { role: 'assistant', content: null, tool_calls: [{ id: 'smoke-call', type: 'function',
            function: { name: 'connection_probe', arguments: '{"acknowledgement":"ready"}' } }] }
        : { role: 'assistant', content: 'OK' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const input = {
      name: 'Key editing regression',
      type: 'openai-compatible', baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      model: 'smoke-model', apiKey: 'smoke-original-1111'
    }
    await page.locator('.nav-button[title="设置"]').click()
    await page.getByRole('button', { name: '添加供应商', exact: true }).click()
    assert.equal(await page.locator('#provider-preset').inputValue(), 'custom')
    assert.equal(await page.locator('#provider-preset option[value="antigravity"]').count(), 0,
      'A third-party gateway must not appear as an official preset')
    for (const id of ['provider-name', 'provider-url', 'provider-key', 'provider-model']) {
      assert.equal(await page.locator(`#${id}`).inputValue(), '', 'New custom providers must start blank')
    }
    await page.locator('#provider-preset').selectOption('openai')
    assert.equal(await page.locator('#provider-url').inputValue(), 'https://api.openai.com/v1')
    assert.equal(await page.locator('#provider-url').getAttribute('readonly'), '')
    await page.locator('#provider-preset').selectOption('custom')
    assert.equal(await page.locator('#provider-url').getAttribute('readonly'), null)
    await page.locator('#provider-name').fill(input.name)
    await page.locator('#provider-url').fill(input.baseUrl)
    const key = page.locator('#provider-key')
    const fetchModels = page.getByRole('button', { name: '获取模型列表', exact: true })
    const save = page.getByRole('button', { name: '保存配置', exact: true })
    const discoverAndSelect = async () => {
      await fetchModels.click()
      await page.locator('#provider-model option[value="smoke-model"]').waitFor({ state: 'attached' })
      await page.locator('#provider-model').selectOption('smoke-model')
    }
    await key.fill(input.apiKey)
    // This interval exceeds the former automatic discovery debounce.
    await page.waitForTimeout(900)
    assert.equal(requests.length, 0, 'Typing provider details must not make automatic network requests')
    assert(await save.isDisabled(), 'A new provider needs an explicitly selected model')
    await fetchModels.click()
    await page.locator('#provider-model option[value="smoke-model"]').waitFor({ state: 'attached' })
    assert.equal(await page.locator('#provider-model').inputValue(), '', 'Fetching must let the user select a model')
    await page.locator('#provider-model').selectOption('smoke-model')
    await save.click()
    await page.waitForFunction(() => document.querySelector('#provider-key')?.placeholder === '••••1111')
    await acknowledgeMessage(page, /已加密保存/)
    const created = await page.evaluate(async (name) =>
      (await window.diskCollie.listAgentProviders()).find((item) => item.name === name), input.name)
    assert(created, 'The new custom provider must be saved through the Renderer')

    await key.fill('smoke-delayed-5555')
    await fetchModels.click()
    await delayedRequested
    await key.fill('smoke-replacement-2222')
    await discoverAndSelect()
    releaseDelayedModels()
    await delayedServed
    // Discovery runs in Electron's main process; allow its response IPC to settle.
    await page.waitForTimeout(250)
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await page.locator('#provider-model option[value="stale-model"]').count(), 0,
      'A stale discovery result must not overwrite a newer connection')
    assert.equal(await page.locator('#provider-model').inputValue(), 'smoke-model')
    await page.locator('#provider-name').fill('Edited local copy')
    await page.getByRole('button', { name: '测试连接', exact: true }).click()
    await page.locator('.provider-editor-header .risk-label').filter({ hasText: '已连接' }).waitFor()
    await acknowledgeMessage(page,/工具调用|tool/i)
    assert.equal(await key.inputValue(), 'smoke-replacement-2222', 'Testing must retain the unsaved replacement key')
    assert.equal(await page.locator('#provider-name').inputValue(), 'Edited local copy')
    assert(requests.some((request) => request.path === '/v1/chat/completions' &&
      request.authorization === 'Bearer smoke-replacement-2222'), 'Connection test must use the replacement key')

    await save.click()
    await page.waitForFunction(() => {
      const key = document.querySelector('#provider-key')
      return key?.value === '' && key.placeholder === '••••2222'
    })
    await acknowledgeMessage(page, /已加密保存/)
    await page.reload()
    await page.locator('.nav-button[title="首页"]').waitFor({ timeout: 60_000 })
    await page.locator('.nav-button[title="设置"]').click()
    await page.locator('.provider-item').filter({ hasText: 'Edited local copy' }).click()
    await page.waitForFunction(() => document.querySelector('#provider-key')?.placeholder === '••••2222')
    const offset = requests.length
    await page.getByRole('button', { name: '测试连接', exact: true }).click()
    await acknowledgeMessage(page,/工具调用|tool/i)
    await page.locator('.provider-editor-header .risk-label').filter({ hasText: '已连接' }).waitFor()
    const savedRequests = requests.slice(offset).filter((request) => request.path === '/v1/chat/completions')
    assert.equal(savedRequests.length, 2)
    assert(savedRequests.every((request) => request.authorization === 'Bearer smoke-replacement-2222'),
      'Requests after reload must use the encrypted saved replacement key')

    await page.locator('#provider-url').fill(`${input.baseUrl}/other`)
    assert.equal(await page.locator('#provider-model').inputValue(), '')
    assert.equal(await key.getAttribute('placeholder'), 'sk-...')
    assert(await fetchModels.isDisabled(), 'An edited endpoint must not reuse the saved key')
    assert(await save.isDisabled(), 'An edited endpoint must not reuse the saved model')
    assert.equal(await page.locator('.provider-editor-header .risk-label').innerText(), '未测试')
    await page.locator('#provider-url').fill(input.baseUrl)
    await key.fill('smoke-invalid-3333')
    await discoverAndSelect()
    await page.getByRole('button', { name: '测试连接', exact: true }).click()
    await page.locator('.provider-error-panel').filter({ hasText: '连接测试失败' }).waitFor()
    await acknowledgeMessage(page,/invalid|401|失败/i)
    assert.equal(await key.inputValue(), 'smoke-invalid-3333', 'Failed tests must retain edits too')
    const saved = await page.evaluate(async (id) => (await window.diskCollie.listAgentProviders()).find((item) => item.id === id), created.id)
    assert.equal(saved.keyHint, '••••2222', 'Testing must not save a draft key')
    assert(!('apiKey' in saved), 'Saved plaintext keys must not cross IPC')

    await key.fill('smoke-direct-save-4444')
    await discoverAndSelect()
    await save.click()
    await page.waitForFunction(() => document.querySelector('#provider-key')?.placeholder === '••••4444')
    await acknowledgeMessage(page,/已加密保存/)
    await page.locator('#provider-name').fill('Renamed without changing the key')
    await page.getByRole('button', { name: '保存配置', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.provider-item.is-active strong')?.textContent === 'Renamed without changing the key')
    assert.equal(await key.getAttribute('placeholder'), '••••4444', 'Blank key must preserve the saved credential')
    await acknowledgeMessage(page,/已加密保存/)
    const finalOffset = requests.length
    await page.getByRole('button', { name: '测试连接', exact: true }).click()
    await acknowledgeMessage(page,/工具调用|tool/i)
    await page.locator('.provider-editor-header .risk-label').filter({ hasText: '已连接' }).waitFor()
    const finalRequests = requests.slice(finalOffset).filter((request) => request.path === '/v1/chat/completions')
    assert.equal(finalRequests.length, 2)
    assert(finalRequests.every((request) => request.authorization === 'Bearer smoke-direct-save-4444'))
    const imported = {
      id: 'cc-switch-smoke-antigravity', name: 'Imported legacy provider', type: 'antigravity',
      baseUrl: `http://127.0.0.1:${server.address().port}/v1beta`, model: 'gemini-imported',
      apiKey: 'smoke-imported-6666'
    }
    await page.evaluate((provider) => window.diskCollie.saveAgentProvider(provider), imported)
    await page.reload()
    await page.locator('.nav-button[title="首页"]').waitFor({ timeout: 60_000 })
    await page.locator('.nav-button[title="设置"]').click()
    await page.locator('.provider-item').filter({ hasText: imported.name }).click()
    await page.waitForFunction(() => document.querySelector('#provider-key')?.placeholder === '••••6666')
    assert.equal(await page.locator('#provider-preset').inputValue(), 'custom')
    assert.equal(await page.locator('#provider-url').getAttribute('readonly'), null)
    assert.equal(await page.locator('#provider-url').inputValue(), imported.baseUrl)
    assert.equal(await page.locator('#provider-model').inputValue(), imported.model)
    await page.locator('#provider-name').fill('Renamed imported provider')
    await save.click()
    await acknowledgeMessage(page, /已加密保存/)
    const preserved = await page.evaluate(async (id) =>
      (await window.diskCollie.listAgentProviders()).find((item) => item.id === id), imported.id)
    assert.equal(preserved.type, imported.type, 'Editing an imported provider must preserve its protocol')
    assert.equal(preserved.keyHint, '••••6666')
    assert.equal(preserved.model, imported.model)
    console.log('Provider regression passed: explicit custom setup, model selection, discovery race, endpoint isolation, encrypted key editing, reload, failure and blank-key preservation')
  } finally {
    releaseDelayedModels()
    await new Promise((resolve) => server.close(resolve))
  }
}
