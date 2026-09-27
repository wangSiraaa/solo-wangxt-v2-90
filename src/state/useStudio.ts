import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Project } from '../types';
import { louis } from '../braille/translator';
import { layoutProject } from '../braille/layout';
import type { Layout } from '../types';
import { saveProject } from '../storage/projectStore';

export interface StudioState {
  ready: boolean;
  engineVersion: string;
  initError: string | null;
  project: Project;
  layout: Layout | null;
  saving: boolean;
  savedAt: number | null;
}

export function useStudio(initial: Project): StudioState & {
  updateProject: (mutator: (p: Project) => void) => void;
  replaceProject: (p: Project) => void;
  saveNow: () => Promise<void>;
} {
  const [ready, setReady] = useState(false);
  const [engineVersion, setEngineVersion] = useState('');
  const [initError, setInitError] = useState<string | null>(null);
  const [project, setProject] = useState<Project>(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    louis
      .init()
      .then(() => {
        if (cancelled) return;
        setReady(true);
        setEngineVersion(louis.version());
      })
      .catch((e: unknown) => {
        if (!cancelled) setInitError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 父组件先渲染"恢复中"占位、从 IndexedDB 读到最近工程后才解除占位。
  // initial 只在水合完成时变化一次（"载入样稿/新建"走 replaceProject，不改 initial），
  // 故这里无条件同步即可，不能用一次性 ref 门控（否则会在水合完成前提前置位而跳过恢复）。
  useEffect(() => {
    setProject(initial);
  }, [initial]);

  const translate = useCallback(
    (text: string) => louis.translate(project.tableId, text),
    [project.tableId],
  );

  const layout = useMemo<Layout | null>(() => {
    if (!ready) return null;
    return layoutProject(project, translate);
  }, [ready, project, translate]);

  const updateProject = useCallback((mutator: (p: Project) => void) => {
    setProject((prev) => {
      const next: Project = structuredClone(prev);
      mutator(next);
      next.updatedAt = Date.now();
      return next;
    });
  }, []);

  const replaceProject = useCallback((p: Project) => {
    setProject({ ...p, updatedAt: Date.now() });
  }, []);

  // 始终指向最新 project，供防抖保存回调读取（避免闭包内拿到旧状态）
  const projectRef = useRef(project);
  projectRef.current = project;

  // 防抖自动保存到 IndexedDB
  useEffect(() => {
    if (!ready) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      setSaving(true);
      saveProject(projectRef.current)
        .then(() => setSavedAt(Date.now()))
        .catch((e: unknown) => setInitError(e instanceof Error ? e.message : String(e)))
        .finally(() => setSaving(false));
    }, 600);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [project, ready]);

  const saveNow = useCallback(async () => {
    setSaving(true);
    try {
      await saveProject(project);
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  }, [project]);

  return { ready, engineVersion, initError, project, layout, saving, savedAt, updateProject, replaceProject, saveNow };
}
