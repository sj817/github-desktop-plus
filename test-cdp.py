import json, asyncio, websockets

async def test():
    url = 'ws://127.0.0.1:19222/devtools/page/62D1CC460066E97E7C340F6E34D08623'
    async with websockets.connect(url) as ws:
        tests = [
            ('process.versions.electron', 'Electron ver'),
            ('process.versions.node', 'Node ver'),
            ('process.type', 'Process type'),
            ('typeof require("electron").ipcRenderer', 'ipcRenderer'),
            ('typeof require("electron").remote', 'remote module'),
            # Test if we can block telemetry from renderer
            ('typeof require("electron").session', 'session access'),
        ]
        for i, (expr, label) in enumerate(tests):
            await ws.send(json.dumps({
                'id': i + 1,
                'method': 'Runtime.evaluate',
                'params': {'expression': expr}
            }))
            r = json.loads(await ws.recv())
            result = r.get('result', {}).get('result', {})
            val = result.get('value', '')
            desc = result.get('description', '')
            exc = r.get('result', {}).get('exceptionDetails', {})
            err_text = exc.get('text', '') if exc else ''
            print(f'{label}: {val or desc or err_text or "?"}')

asyncio.run(test())
