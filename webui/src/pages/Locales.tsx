import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Select, SelectItem, useDisclosure, Chip, Textarea } from '@heroui/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Locales, type LocaleEntry, type LocaleSummary } from '@/api/client'
import { AppShell } from '@/components/AppShell'
import { GlassCard } from '@/components/GlassCard'

export default function LocalesPage() {
  const qc = useQueryClient()
  const list = useQuery<LocaleSummary[]>({ queryKey: ['locales'], queryFn: Locales.list })

  const [locale, setLocale] = useState<string>('zh-CN')
  const [category, setCategory] = useState<string>('ui')
  const [filter, setFilter] = useState('')

  const cats = useMemo(
    () => list.data?.find((x) => x.locale === locale)?.categories ?? [],
    [list.data, locale],
  )

  useEffect(() => {
    if (cats.length && !cats.includes(category)) setCategory(cats[0])
  }, [cats, category])

  const entries = useQuery<LocaleEntry[]>({
    queryKey: ['locale', locale, category],
    queryFn: () => Locales.get(locale, category),
    enabled: !!locale && !!category,
  })

  const [draft, setDraft] = useState<Map<string, string>>(new Map())
  useEffect(() => { setDraft(new Map()) }, [locale, category])

  const filtered = useMemo(() => {
    const arr = entries.data ?? []
    if (!filter) return arr
    const q = filter.toLowerCase()
    return arr.filter((e) => e.key.toLowerCase().includes(q) || e.value.toLowerCase().includes(q))
  }, [entries.data, filter])

  const save = useMutation({
    mutationFn: async () => {
      const merged: LocaleEntry[] = (entries.data ?? []).map((e) =>
        draft.has(e.key) ? { key: e.key, value: draft.get(e.key)! } : e,
      )
      return Locales.put(locale, category, merged)
    },
    onSuccess: () => {
      setDraft(new Map())
      qc.invalidateQueries({ queryKey: ['locale', locale, category] })
    },
  })

  const newKeyModal = useDisclosure()
  const importModal = useDisclosure()
  const newLocaleModal = useDisclosure()

  return (
    <AppShell title="语言包" subtitle="对运行中的 GitHub Desktop 实时热更新文案">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
        <GlassCard hoverable={false} className="!p-4">
          <div className="mb-3 px-2 text-[11px] uppercase tracking-[0.2em] text-default-400">语言</div>
          <div className="space-y-1">
            {(list.data ?? []).map((l) => (
              <button
                key={l.locale}
                onClick={() => setLocale(l.locale)}
                className={[
                  'flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-[13.5px] transition',
                  l.locale === locale
                    ? 'bg-primary-500/15 text-primary-500'
                    : 'text-default-600 hover:bg-foreground/5',
                ].join(' ')}
              >
                <span className="font-medium">{l.locale}</span>
                <span className="text-[11px] text-default-400">{l.total_keys} 词条</span>
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-col gap-2 px-1">
            <Button size="sm" variant="flat" onPress={newLocaleModal.onOpen}>+ 新建语言</Button>
            <Button size="sm" variant="flat" onPress={importModal.onOpen}>↥ 导入</Button>
            <a className="block" href={Locales.exportUrl(locale)} download={`${locale}.json`}>
              <Button size="sm" variant="flat" className="w-full">↧ 导出当前</Button>
            </a>
            {locale !== 'zh-CN' && (
              <Button
                size="sm"
                variant="flat"
                color="danger"
                onPress={async () => {
                  if (!confirm(`确定删除语言 "${locale}" ?`)) return
                  await Locales.deleteLocale(locale)
                  setLocale('zh-CN')
                  qc.invalidateQueries({ queryKey: ['locales'] })
                }}
              >
                删除当前语言
              </Button>
            )}
          </div>
        </GlassCard>

        <div className="flex flex-col gap-4">
          <GlassCard hoverable={false} className="!p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Select
                size="sm"
                label="分类"
                selectedKeys={[category]}
                onChange={(e) => setCategory(e.target.value)}
                className="w-[200px]"
              >
                {cats.map((c) => (
                  <SelectItem key={c}>{c}</SelectItem>
                ))}
              </Select>
              <Input
                size="sm"
                placeholder="搜索 key 或 value…"
                value={filter}
                onValueChange={setFilter}
                className="max-w-sm"
              />
              <div className="ml-auto flex items-center gap-2">
                <Chip size="sm" variant="flat">
                  {filtered.length} / {entries.data?.length ?? 0}
                </Chip>
                <Button size="sm" variant="flat" onPress={newKeyModal.onOpen}>+ 新词条</Button>
                <Button
                  size="sm"
                  color="primary"
                  isDisabled={draft.size === 0}
                  isLoading={save.isPending}
                  onPress={() => save.mutate()}
                >
                  保存（{draft.size}）
                </Button>
              </div>
            </div>
          </GlassCard>

          <GlassCard hoverable={false} className="!p-0 overflow-hidden">
            <div className="grid grid-cols-[1fr_2fr_auto] gap-px bg-divider/60 text-[12px] uppercase tracking-wider text-default-500">
              <div className="bg-content1/60 px-4 py-2.5">Key</div>
              <div className="bg-content1/60 px-4 py-2.5">Value</div>
              <div className="bg-content1/60 px-4 py-2.5">操作</div>
            </div>
            <div className="max-h-[calc(100vh-330px)] overflow-auto">
              {filtered.map((e) => {
                const dirty = draft.has(e.key)
                const v = dirty ? draft.get(e.key)! : e.value
                return (
                  <div
                    key={e.key}
                    className={[
                      'grid grid-cols-[1fr_2fr_auto] items-center gap-px border-b border-divider/40 transition',
                      dirty ? 'bg-primary-500/[0.05]' : 'hover:bg-foreground/[0.03]',
                    ].join(' ')}
                  >
                    <div className="px-4 py-2 font-mono text-[12.5px] text-default-700">{e.key}</div>
                    <div className="px-2 py-1.5">
                      <Input
                        size="sm"
                        value={v}
                        onValueChange={(nv) => {
                          const next = new Map(draft)
                          if (nv === e.value) next.delete(e.key)
                          else next.set(e.key, nv)
                          setDraft(next)
                        }}
                        variant="flat"
                        classNames={{ inputWrapper: 'bg-transparent shadow-none' }}
                      />
                    </div>
                    <div className="px-3 py-1.5">
                      <Button
                        size="sm"
                        variant="light"
                        color="danger"
                        onPress={async () => {
                          if (!confirm(`删除 ${e.key} ?`)) return
                          await Locales.deleteKey(locale, category, e.key)
                          qc.invalidateQueries({ queryKey: ['locale', locale, category] })
                        }}
                      >
                        删除
                      </Button>
                    </div>
                  </div>
                )
              })}
              {filtered.length === 0 && (
                <div className="px-6 py-16 text-center text-[13px] text-default-400">无匹配词条</div>
              )}
            </div>
          </GlassCard>
        </div>
      </div>

      <NewKeyModal
        disc={newKeyModal}
        locale={locale}
        category={category}
        onDone={() => qc.invalidateQueries({ queryKey: ['locale', locale, category] })}
      />
      <ImportModal
        disc={importModal}
        locale={locale}
        onDone={() => qc.invalidateQueries({ queryKey: ['locales'] })}
      />
      <NewLocaleModal
        disc={newLocaleModal}
        onDone={(name) => {
          qc.invalidateQueries({ queryKey: ['locales'] })
          if (name) setLocale(name)
        }}
      />
    </AppShell>
  )
}

type Disc = ReturnType<typeof useDisclosure>

function NewKeyModal({ disc, locale, category, onDone }: { disc: Disc; locale: string; category: string; onDone: () => void }) {
  const [k, setK] = useState(''); const [v, setV] = useState('')
  const submit = async () => {
    if (!k.trim()) return
    await Locales.upsertKey(locale, category, k.trim(), v)
    setK(''); setV(''); disc.onClose(); onDone()
  }
  return (
    <Modal isOpen={disc.isOpen} onClose={disc.onClose} backdrop="blur">
      <ModalContent>
        <ModalHeader>新增词条 · {locale}/{category}</ModalHeader>
        <ModalBody className="space-y-3">
          <Input label="Key" value={k} onValueChange={setK} variant="bordered" />
          <Input label="Value" value={v} onValueChange={setV} variant="bordered" />
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={disc.onClose}>取消</Button>
          <Button color="primary" onPress={submit}>保存</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

function ImportModal({ disc, locale, onDone }: { disc: Disc; locale: string; onDone: () => void }) {
  const [text, setText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const submit = async () => {
    try {
      const json = JSON.parse(text)
      await Locales.importLocale(locale, json)
      setText(''); disc.onClose(); onDone()
    } catch (e) {
      alert('JSON 解析失败：' + (e as Error).message)
    }
  }
  return (
    <Modal isOpen={disc.isOpen} onClose={disc.onClose} backdrop="blur" size="2xl">
      <ModalContent>
        <ModalHeader>导入语言包 → {locale}</ModalHeader>
        <ModalBody className="space-y-3">
          <p className="text-[12.5px] text-default-500">
            支持两种格式：<br />
            1) 整包：<code>{'{ "ui": { "key": "value" }, "menu": { ... } }'}</code><br />
            2) 单分类：上方"分类"切到目标分类后，粘贴 <code>{'{ "key": "value" }'}</code> 形式
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="text-[12px] text-default-500"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (f) setText(await f.text())
            }}
          />
          <Textarea
            minRows={10}
            value={text}
            onValueChange={setText}
            placeholder='{ "ui": { ... }, "menu": { ... } }'
            variant="bordered"
            classNames={{ input: 'font-mono text-[12px]' }}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={disc.onClose}>取消</Button>
          <Button color="primary" onPress={submit} isDisabled={!text.trim()}>导入</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

function NewLocaleModal({ disc, onDone }: { disc: Disc; onDone: (name?: string) => void }) {
  const [name, setName] = useState('')
  const submit = async () => {
    const v = name.trim()
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{1,15}$/.test(v)) {
      alert('语言代码格式不合法（如 en-US, ja, fr-FR）')
      return
    }
    await Locales.createLocale(v)
    setName(''); disc.onClose(); onDone(v)
  }
  return (
    <Modal isOpen={disc.isOpen} onClose={disc.onClose} backdrop="blur">
      <ModalContent>
        <ModalHeader>新建语言</ModalHeader>
        <ModalBody>
          <Input
            label="语言代码"
            placeholder="例如 en-US"
            value={name}
            onValueChange={setName}
            variant="bordered"
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={disc.onClose}>取消</Button>
          <Button color="primary" onPress={submit}>创建</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
