import React, { useState, useEffect, useRef } from 'react';
import {
  Database, Server, Lock, Unlock, Activity, Terminal,
  RotateCcw, AlertCircle, Save, Layers, PlayCircle, StopCircle, Eye,
  GripVertical, GripHorizontal, ChevronDown
} from 'lucide-react';
import AppLogo from "./Icon";

// --- 初始数据 ---
const INITIAL_PRODUCTS = [
  { id: 1, name: 'iPhone 15 Pro', stock: 100 },
  { id: 2, name: 'MacBook M3', stock: 1 },
  { id: 3, name: 'AirPods Pro', stock: 200 }
];

const ISOLATION_LEVELS = {
  RU: 'READ-UNCOMMITTED',
  RC: 'READ-COMMITTED',
  RR: 'REPEATABLE-READ',
  SR: 'SERIALIZABLE'
};

const MySQLMonitorV3 = () => {
  // --- 状态管理 ---

  // 全局配置
  const [isolationLevel, setIsolationLevel] = useState(ISOLATION_LEVELS.RR);

  // 核心数据 (committed state)
  const [committedData, setCommittedData] = useState(INITIAL_PRODUCTS);

  // 布局尺寸状态 (单位: px 或 %)
  const [sidebarWidth, setSidebarWidth] = useState(380); // 左侧宽度
  const [rightTopHeight, setRightTopHeight] = useState(35); // 右上高度 %
  const [rightMiddleHeight, setRightMiddleHeight] = useState(35); // 右中高度 %
  // 右下高度 = 100% - Top - Middle

  // 模拟 Session 状态
  const [sessions, setSessions] = useState({
    A: { id: 'trx_A', status: 'idle', active: false, buffer: {}, snapshot: null, waitingFor: null, lastSql: null, targetId: 1 },
    B: { id: 'trx_B', status: 'idle', active: false, buffer: {}, snapshot: null, waitingFor: null, lastSql: null, targetId: 1 }
  });

  // 锁表
  const [locks, setLocks] = useState([]);

  // 系统日志
  const [logs, setLogs] = useState([]);

  // --- Refs (用于解决异步回调中的闭包陈旧数据问题) ---
  const sessionsRef = useRef(sessions);
  const committedDataRef = useRef(committedData);
  const isolationLevelRef = useRef(isolationLevel);

  // 拖拽 Ref
  const containerRef = useRef(null);
  const rightColumnRef = useRef(null);
  const draggingRef = useRef(null); // 'sidebar' | 'inventory' | 'locks'

  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { committedDataRef.current = committedData; }, [committedData]);
  useEffect(() => { isolationLevelRef.current = isolationLevel; }, [isolationLevel]);

  // --- 拖拽处理逻辑 ---
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!draggingRef.current) return;

      if (draggingRef.current === 'sidebar') {
        const newWidth = Math.max(250, Math.min(e.clientX, 600));
        setSidebarWidth(newWidth);
      } else if (draggingRef.current === 'inventory' || draggingRef.current === 'locks') {
        if (!rightColumnRef.current) return;
        const rect = rightColumnRef.current.getBoundingClientRect();
        const relativeY = e.clientY - rect.top;
        const percentageY = (relativeY / rect.height) * 100;

        if (draggingRef.current === 'inventory') {
          const newH = Math.max(15, Math.min(percentageY, 70));
          setRightTopHeight(newH);
        } else if (draggingRef.current === 'locks') {
          const totalTopHeight = percentageY;
          const newLocksHeight = totalTopHeight - rightTopHeight;

          if (newLocksHeight > 10 && (100 - totalTopHeight) > 10) {
            setRightMiddleHeight(newLocksHeight);
          }
        }
      }
    };

    const handleMouseUp = () => {
      draggingRef.current = null;
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [rightTopHeight]);

  const startDrag = (type) => (e) => {
    e.preventDefault();
    draggingRef.current = type;
    document.body.style.cursor = type === 'sidebar' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  };

  // --- 辅助函数 ---

  const addLog = (source, message, type = 'info') => {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setLogs(prev => [{ id: Date.now() + Math.random(), time, source, message, type }, ...prev].slice(0, 50));
  };

  const resetSimulation = () => {
    setCommittedData(JSON.parse(JSON.stringify(INITIAL_PRODUCTS)));
    setSessions({
      A: { id: 'trx_A', status: 'idle', active: false, buffer: {}, snapshot: null, waitingFor: null, lastSql: null, targetId: 1 },
      B: { id: 'trx_B', status: 'idle', active: false, buffer: {}, snapshot: null, waitingFor: null, lastSql: null, targetId: 1 }
    });
    setLocks([]);
    setLogs([]);
    addLog('SYSTEM', '系统已重置，隔离级别保持不变。', 'warn');
  };

  // --- 核心引擎逻辑 (保持不变) ---
  const getRowData = (sessionName, row) => {
    const session = sessions[sessionName];
    const otherSessionName = sessionName === 'A' ? 'B' : 'A';
    const otherSession = sessions[otherSessionName];
    if (session.buffer[row.id]) return session.buffer[row.id];
    if (isolationLevel === ISOLATION_LEVELS.RU) {
      if (otherSession.buffer[row.id]) return otherSession.buffer[row.id];
    }
    if (isolationLevel === ISOLATION_LEVELS.RR && session.active && session.snapshot) {
      const snapshotRow = session.snapshot.find(r => r.id === row.id);
      return snapshotRow || row;
    }
    return row;
  };

  const checkLock = (trxId, resourceId, requestMode) => {
    const existingLocks = locks.filter(l => l.resourceId === resourceId && l.status === 'GRANTED');
    const otherLocks = existingLocks.filter(l => l.trxId !== trxId);
    if (otherLocks.length === 0) return { compatible: true };
    for (const lock of otherLocks) {
      if (lock.mode === 'X' || requestMode === 'X') {
        return { compatible: false, conflictLock: lock };
      }
    }
    return { compatible: true, conflictLock: null };
  };

  const detectDeadlock = (waiterTrxId, holderTrxId) => {
    const holderSessionName = holderTrxId === 'trx_A' ? 'A' : 'B';
    const holderSession = sessions[holderSessionName];
    if (holderSession.waitingFor) {
      const resourceId = holderSession.waitingFor;
      const blockingLocks = locks.filter(l => l.resourceId === resourceId && l.status === 'GRANTED');
      return blockingLocks.some(l => l.trxId === waiterTrxId);
    }
    return false;
  };

  const handleUpdate = (sessionName, id, isAutoCommit) => {
    const currentSessions = sessionsRef.current;
    const currentCommitted = committedDataRef.current;
    const currentIso = isolationLevelRef.current;
    const session = currentSessions[sessionName];
    const committedStock = currentCommitted.find(p => p.id === id).stock;
    const baseValForUpdate = session.buffer[id] ? session.buffer[id].stock : committedStock;
    const newVal = baseValForUpdate - 1;
    let snapshotVal = baseValForUpdate;
    if (currentIso === ISOLATION_LEVELS.RR && session.active && session.snapshot) {
      const snapRow = session.snapshot.find(r => r.id === id);
      if (snapRow) snapshotVal = snapRow.stock;
      if (session.buffer[id]) snapshotVal = session.buffer[id].stock;
    }
    if (snapshotVal !== baseValForUpdate) {
      addLog(sessionName, `⚠️ Current Read: 忽略快照(${snapshotVal})，基于最新值(${baseValForUpdate})更新`, 'warn');
    }
    if (isAutoCommit) {
      setCommittedData(prev => prev.map(p => p.id === id ? { ...p, stock: newVal } : p));
      addLog(sessionName, `Query OK (Auto-Commit), Stock: ${baseValForUpdate} -> ${newVal}`, 'success');
    } else {
      setSessions(prev => ({
        ...prev,
        [sessionName]: {
          ...prev[sessionName],
          buffer: { ...prev[sessionName].buffer, [id]: { stock: newVal } }
        }
      }));
      addLog(sessionName, `Query OK (Buffer), Stock: ${baseValForUpdate} -> ${newVal}`, 'success');
    }
  };

  // --- SQL 执行引擎 (保持不变) ---
  const executeSql = (sessionName, type, params = {}) => {
    const trxId = sessions[sessionName].id;
    const session = sessions[sessionName];
    let sqlDisplay = '';

    if (type === 'BEGIN') {
      if (session.active) return addLog(sessionName, '事务已开启', 'warn');
      const snapshot = JSON.parse(JSON.stringify(committedData));
      setSessions(prev => ({
        ...prev,
        [sessionName]: { ...prev[sessionName], active: true, buffer: {}, snapshot: snapshot, lastSql: 'START TRANSACTION;' }
      }));
      addLog(sessionName, 'START TRANSACTION;', 'sql');
      return;
    }
    if (type === 'COMMIT') {
      if (!session.active) return addLog(sessionName, '没有活跃事务可提交', 'warn');
      const updates = session.buffer;
      if (Object.keys(updates).length > 0) {
        setCommittedData(prev => prev.map(p => updates[p.id] ? { ...p, ...updates[p.id] } : p));
      }
      releaseLocks(trxId);
      setSessions(prev => ({ ...prev, [sessionName]: { ...prev[sessionName], active: false, buffer: {}, snapshot: null, waitingFor: null, lastSql: 'COMMIT;' } }));
      addLog(sessionName, 'COMMIT;', 'sql');
      return;
    }
    if (type === 'ROLLBACK') {
      if (!session.active) return;
      releaseLocks(trxId);
      setSessions(prev => ({ ...prev, [sessionName]: { ...prev[sessionName], active: false, buffer: {}, snapshot: null, waitingFor: null, lastSql: 'ROLLBACK;' } }));
      addLog(sessionName, 'ROLLBACK;', 'sql');
      return;
    }

    const targetId = session.targetId;
    const isAutoCommit = !session.active;
    let lockMode = null;
    let operation = null;

    if (type === 'SELECT_PLAIN') {
      sqlDisplay = `SELECT * FROM products WHERE id = ${targetId};`;
      if (isolationLevel === ISOLATION_LEVELS.SR) { lockMode = 'S'; operation = 'READ'; }
      else { lockMode = null; operation = 'READ'; }
    } else if (type === 'SELECT_SHARE') {
      sqlDisplay = `SELECT * FROM products WHERE id = ${targetId} FOR SHARE;`;
      lockMode = 'S'; operation = 'READ';
    } else if (type === 'SELECT_UPDATE') {
      sqlDisplay = `SELECT * FROM products WHERE id = ${targetId} FOR UPDATE;`;
      lockMode = 'X'; operation = 'READ';
    } else if (type === 'UPDATE') {
      sqlDisplay = `UPDATE products SET stock = stock - 1 WHERE id = ${targetId};`;
      lockMode = 'X'; operation = 'WRITE';
    }

    setSessions(prev => ({ ...prev, [sessionName]: { ...prev[sessionName], lastSql: sqlDisplay } }));
    addLog(sessionName, sqlDisplay, 'sql');

    const proceedWithExecution = () => {
      if (operation === 'WRITE') {
        handleUpdate(sessionName, targetId, isAutoCommit);
        if (isAutoCommit) releaseLocks(trxId);
      } else {
        const row = committedData.find(r => r.id === targetId);
        const visibleData = getRowData(sessionName, row);
        addLog(sessionName, `=> ID: ${targetId}, Name: ${row.name}, Stock: ${visibleData.stock}`, 'result');
        if (isAutoCommit && lockMode) releaseLocks(trxId);
      }
    };

    if (lockMode) {
      const { compatible, conflictLock } = checkLock(trxId, targetId, lockMode);
      if (compatible) {
        grantLock(trxId, targetId, lockMode);
        proceedWithExecution();
      } else {
        addLog(sessionName, `(Blocked) 等待 ${conflictLock.trxId} 释放 ID=${targetId}...`, 'error');
        if (detectDeadlock(trxId, conflictLock.trxId)) {
          addLog('SYSTEM', `❌ 检测到死锁！回滚 ${sessionName}。`, 'error');
          executeSql(sessionName, 'ROLLBACK');
          return;
        }
        setLocks(prev => [...prev, {
          trxId, resourceId: targetId, mode: lockMode, status: 'WAITING', type: 'RECORD', requestTime: Date.now(),
          pendingAction: () => {
            const currentSessions = sessionsRef.current;
            const currentCommitted = committedDataRef.current;
            const currentIso = isolationLevelRef.current;
            const wakeUpSession = currentSessions[sessionName];
            const wakeUpIsAutoCommit = !wakeUpSession.active;

            if (operation === 'WRITE') {
              handleUpdate(sessionName, targetId, wakeUpIsAutoCommit);
              if (wakeUpIsAutoCommit) releaseLocks(trxId);
            } else {
              const currentRow = currentCommitted.find(r => r.id === targetId);
              const currentSess = currentSessions[sessionName];
              const otherName = sessionName === 'A' ? 'B' : 'A';
              const otherSess = currentSessions[otherName];
              let visibleStock = currentRow.stock;
              if (currentSess.buffer[targetId]) visibleStock = currentSess.buffer[targetId].stock;
              else if (currentIso === ISOLATION_LEVELS.RU && otherSess.buffer[targetId]) visibleStock = otherSess.buffer[targetId].stock;
              else if (currentIso === ISOLATION_LEVELS.RR && currentSess.active && currentSess.snapshot) {
                const snapRow = currentSess.snapshot.find(r => r.id === targetId);
                if (snapRow) visibleStock = snapRow.stock;
              }
              addLog(sessionName, `(唤醒后) => ID: ${targetId}, Stock: ${visibleStock}`, 'result');
              if (wakeUpIsAutoCommit && lockMode) releaseLocks(trxId);
            }
          }
        }]);
        setSessions(prev => ({ ...prev, [sessionName]: { ...prev[sessionName], waitingFor: targetId } }));
      }
    } else {
      proceedWithExecution();
    }
  };

  const grantLock = (trxId, resourceId, mode) => {
    setLocks(prev => {
      const filtered = prev.filter(l => !(l.trxId === trxId && l.resourceId === resourceId));
      const existingX = prev.find(l => l.trxId === trxId && l.resourceId === resourceId && l.mode === 'X' && l.status === 'GRANTED');
      if (existingX) return prev;
      return [...filtered, { trxId, resourceId, mode, status: 'GRANTED', type: 'RECORD', requestTime: Date.now() }];
    });
  };

  const releaseLocks = (trxId) => {
    setLocks(prev => prev.filter(l => l.trxId !== trxId));
  };

  // --- 唤醒机制 ---
  useEffect(() => {
    const waitingLocks = locks.filter(l => l.status === 'WAITING').sort((a, b) => a.requestTime - b.requestTime);
    if (waitingLocks.length === 0) return;
    const candidate = waitingLocks[0];
    const { compatible } = checkLock(candidate.trxId, candidate.resourceId, candidate.mode);
    if (compatible) {
      const sessionName = candidate.trxId === 'trx_A' ? 'A' : 'B';
      setLocks(prev => {
        const others = prev.filter(l => l !== candidate);
        return [...others, { ...candidate, status: 'GRANTED' }];
      });
      setSessions(prev => ({ ...prev, [sessionName]: { ...prev[sessionName], waitingFor: null } }));
      addLog(sessionName, `获得 ID=${candidate.resourceId} 的锁`, 'success');
      if (candidate.pendingAction) candidate.pendingAction();
    }
  }, [locks, committedData]);

  // --- UI 渲染辅助 ---
  const getDisplayValue = (sessionName, row) => {
    const data = getRowData(sessionName, row);
    return data.stock;
  };

  const getSessionTheme = (name) => {
    if (name === 'A') {
      return {
        text: 'text-purple-800',
        border: 'border-purple-300',
        bgActive: 'bg-purple-50',
        iconColor: 'text-purple-600',
        buttonBorder: 'border-purple-200',
        buttonText: 'text-purple-700',
        buttonHover: 'hover:bg-purple-100',
      };
    } else {
      return {
        text: 'text-amber-800',
        border: 'border-amber-300',
        bgActive: 'bg-amber-50',
        iconColor: 'text-amber-600',
        buttonBorder: 'border-amber-200',
        buttonText: 'text-amber-700',
        buttonHover: 'hover:bg-amber-100',
      };
    }
  };

  return (
    <div className="flex min-h-screen flex-col h-full bg-slate-50 text-slate-800 font-sans text-sm select-none" ref={containerRef}>

      {/* 顶部栏 */}
      <div className="bg-gradient-to-r from-[#3e0050] to-[#62007e] p-3 flex flex-wrap gap-4 justify-between items-center shadow-md shrink-0 border-b border-purple-900/10 z-50 relative">
        <div className="flex items-center gap-3">
          <div className="bg-white/20 p-1.5 rounded-lg border border-white/20">
            <AppLogo />
          </div>
          <div>
            <h1 className="font-bold text-white leading-tight tracking-wide">MySQL 事务隔离 & 锁 LAB</h1>
            <div className="text-[10px] text-purple-100/80">InnoDB Engine Simulator</div>
          </div>
        </div>

        {/* 优化样式的隔离级别选择器 */}
        <div className="flex items-center gap-3">
          <div className="relative group">
            <div className="flex items-center bg-white/10 backdrop-blur-md border border-white/20 rounded-lg px-1 py-1 shadow-sm hover:bg-white/20 transition-all">
              <div className="px-3 py-1.5 text-xs font-bold text-amber-300 border-r border-white/20 flex items-center gap-2">
                <Activity size={12} /> Isolation
              </div>
              <div className="relative">
                <select
                  value={isolationLevel}
                  onChange={(e) => {
                    if (sessions.A.active || sessions.B.active) {
                      alert("请先提交或回滚当前所有事务，再切换隔离级别。");
                      return;
                    }
                    setIsolationLevel(e.target.value);
                    addLog("SYSTEM", `隔离级别切换为: ${e.target.value}`, 'warn');
                  }}
                  className="appearance-none bg-transparent text-white text-xs font-bold pl-3 pr-8 py-1.5 outline-none cursor-pointer hover:text-amber-100"
                >
                  <option value={ISOLATION_LEVELS.RU} className="text-slate-900 bg-white">READ-UNCOMMITTED</option>
                  <option value={ISOLATION_LEVELS.RC} className="text-slate-900 bg-white">READ-COMMITTED</option>
                  <option value={ISOLATION_LEVELS.RR} className="text-slate-900 bg-white">REPEATABLE-READ</option>
                  <option value={ISOLATION_LEVELS.SR} className="text-slate-900 bg-white">SERIALIZABLE</option>
                </select>
                <div className="absolute right-2 top-1/2 transform -translate-y-1/2 pointer-events-none text-white/70">
                  <ChevronDown size={12} />
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={resetSimulation}
            className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white border border-white/20 px-3 py-2 rounded-lg transition-all active:scale-95 font-bold text-xs shadow-sm"
          >
            <RotateCcw size={14} /> 重置
          </button>
        </div>
      </div>

      {/* 主体内容 */}
      <div className="flex flex-1 overflow-hidden relative">

        {/* 左侧：Session A & B 整体 (可调宽度) */}
        <div
          className="flex flex-col border-r border-slate-200 bg-white relative shrink-0"
          style={{ width: sidebarWidth }}
        >
          {['A', 'B'].map(name => {
            const session = sessions[name];
            const isActive = session.active;
            const isWaiting = session.waitingFor !== null;
            const theme = getSessionTheme(name);

            return (
              <div key={name} className={`flex-1 flex flex-col border-b border-slate-200 last:border-0 relative transition-colors duration-300 ${isActive ? theme.bgActive : 'bg-white'}`}>
                {/* Session 标题 */}
                <div className={`p-2 px-3 flex justify-between items-center border-l-4 ${theme.border} bg-slate-50 border-b border-slate-100`}>
                  <div className="flex items-center gap-2">
                    <Terminal size={14} className={theme.iconColor} />
                    <span className={`font-bold ${theme.text}`}>Session {name}</span>
                    {isActive && <span className="text-[10px] text-slate-500 font-mono ml-2">autocommit=0</span>}
                  </div>
                  {isWaiting ? (
                    <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded border border-yellow-200 flex items-center gap-1 animate-pulse"><AlertCircle size={10} /> 等待中</span>
                  ) : (
                    isActive ? <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded border border-green-200">Txn Active</span> : null
                  )}
                </div>

                {/* 控制区 */}
                <div className="p-4 flex-1 overflow-y-auto space-y-3">
                  <div className="flex justify-between items-center bg-slate-50 p-1.5 rounded border border-slate-200">
                    <label className="text-[10px] uppercase font-bold text-slate-500">Target ID</label>
                    <select
                      value={session.targetId}
                      onChange={(e) => setSessions(prev => ({ ...prev, [name]: { ...prev[name], targetId: parseInt(e.target.value) } }))}
                      className="bg-transparent text-xs rounded px-2 py-0.5 text-slate-700 outline-none flex-1 text-right"
                    >
                      {committedData.map(p => <option key={p.id} value={p.id}>{p.id} - {p.name}</option>)}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => executeSql(name, isActive ? 'COMMIT' : 'BEGIN')}
                      className={`flex items-center justify-center gap-1 py-1.5 rounded text-xs font-bold border transition-all ${isActive
                        ? 'bg-green-50 border-green-300 text-green-700 hover:bg-green-100'
                        : `${theme.buttonBorder} ${theme.buttonText} ${theme.buttonHover} bg-white shadow-sm`
                        }`}
                    >
                      {isActive ? <><StopCircle size={12} /> COMMIT</> : <><PlayCircle size={12} /> BEGIN</>}
                    </button>
                    <button
                      onClick={() => executeSql(name, 'ROLLBACK')}
                      disabled={!isActive}
                      className="py-1.5 rounded text-xs border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed bg-white shadow-sm"
                    >
                      ROLLBACK
                    </button>
                  </div>

                  <hr className="border-slate-100" />

                  <div className="space-y-2">
                    {isolationLevel !== ISOLATION_LEVELS.SR && (
                      <button
                        onClick={() => executeSql(name, 'SELECT_PLAIN')} disabled={isWaiting}
                        className={`w-full text-left text-xs p-2 rounded bg-white ${theme.buttonHover} ${theme.buttonBorder} border flex justify-between group disabled:opacity-50 transition-colors shadow-sm`}
                      >
                        <span className="font-mono text-slate-600">
                          SELECT * <span className="text-[10px] text-slate-400 ml-1">
                            {isolationLevel === ISOLATION_LEVELS.RU ? '(脏读)' : '(快照读/MVCC)'}
                          </span>
                        </span>
                        <Eye size={12} className="text-slate-400" />
                      </button>
                    )}

                    <button
                      onClick={() => executeSql(name, 'SELECT_SHARE')} disabled={isWaiting}
                      className={`w-full text-left text-xs p-2 rounded bg-white ${theme.buttonHover} ${theme.buttonBorder} border flex justify-between group disabled:opacity-50 transition-colors shadow-sm`}
                    >
                      <span className="font-mono text-cyan-700">SELECT ... FOR SHARE</span>
                      <Lock size={12} className="text-cyan-600 group-hover:text-cyan-500" />
                    </button>

                    <button
                      onClick={() => executeSql(name, 'SELECT_UPDATE')} disabled={isWaiting}
                      className={`w-full text-left text-xs p-2 rounded bg-white ${theme.buttonHover} ${theme.buttonBorder} border flex justify-between group disabled:opacity-50 transition-colors shadow-sm`}
                    >
                      <span className="font-mono text-blue-700">SELECT ... FOR UPDATE</span>
                      <Lock size={12} className="text-blue-600 group-hover:text-blue-500" />
                    </button>

                    <button
                      onClick={() => executeSql(name, 'UPDATE')} disabled={isWaiting}
                      className={`w-full text-left text-xs p-2 rounded bg-white ${theme.buttonHover} ${theme.buttonBorder} border flex justify-between group disabled:opacity-50 transition-colors shadow-sm`}
                    >
                      <span className="font-mono text-amber-700">UPDATE stock - 1</span>
                      <Save size={12} className="text-amber-600 group-hover:text-amber-500" />
                    </button>
                  </div>
                </div>

                {/* 小终端 - 改为白色风格 */}
                <div className="bg-slate-100 p-2 text-[10px] font-mono text-slate-600 border-t border-slate-200 truncate h-8 flex items-center">
                  <span className="mr-2 text-purple-600">mysql&gt;</span> {session.lastSql || 'Waiting for input...'}
                </div>
              </div>
            );
          })}
        </div>

        {/* 垂直分割条 (拖拽把手) */}
        <div
          className="w-1 bg-slate-200 hover:bg-purple-400 cursor-col-resize flex items-center justify-center z-10 transition-colors group relative"
          onMouseDown={startDrag('sidebar')}
        >
          <div className="h-8 w-3 bg-white border border-slate-300 rounded-full flex items-center justify-center absolute group-hover:border-purple-400 shadow-sm">
            <GripVertical size={10} className="text-slate-400 group-hover:text-purple-500" />
          </div>
        </div>

        {/* 右侧：三个可调整区域 */}
        <div className="flex-1 flex flex-col bg-slate-50 min-w-0" ref={rightColumnRef}>

          {/* 1. 库存表 (Top) */}
          <div style={{ height: `${rightTopHeight}%` }} className="flex flex-col border-b border-slate-200 bg-white min-h-[100px]">
            <div className="p-2 px-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center shadow-sm shrink-0 h-9">
              <h3 className="font-bold text-slate-700 flex items-center gap-2 text-xs">
                <Layers size={12} className="text-purple-600" /> 库存表 (Session View)
              </h3>
              <div className="text-[10px] text-slate-500 flex gap-4">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-400"></span> Committed</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400"></span> Dirty/Uncommitted</span>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-left border-collapse">
                <thead className="text-slate-500 bg-slate-100 sticky top-0 z-0 text-xs shadow-sm">
                  <tr>
                    <th className="p-2 pl-4 w-12 border-b border-slate-200">ID</th>
                    <th className="p-2 border-b border-slate-200">Name</th>
                    <th className="p-2 text-center w-24 border-b border-slate-200">Row Locks</th>
                    <th className="p-2 text-right text-purple-700 border-l border-b border-slate-200 bg-purple-50/50">Session A</th>
                    <th className="p-2 text-right text-amber-700 border-l border-b border-slate-200 bg-amber-50/50">Session B</th>
                  </tr>
                </thead>
                <tbody className="text-xs">
                  {committedData.map(row => {
                    const rowLocks = locks.filter(l => l.resourceId === row.id);
                    const valA = getDisplayValue('A', row);
                    const valB = getDisplayValue('B', row);
                    const isDirtyA = valA !== row.stock;
                    const isDirtyB = valB !== row.stock;
                    const isFocused = sessions.A.targetId === row.id || sessions.B.targetId === row.id;

                    return (
                      <tr key={row.id} className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${isFocused ? 'bg-blue-50/50' : ''}`}>
                        <td className="p-2 pl-4 font-mono text-slate-500">{row.id}</td>
                        <td className="p-2 text-slate-800 font-medium">{row.name}</td>
                        <td className="p-2">
                          <div className="flex justify-center flex-wrap gap-1 min-h-[20px]">
                            {rowLocks.map((l, idx) => (
                              <span key={idx} className={`px-1.5 py-0.5 rounded text-[10px] font-bold border flex items-center ${l.status === 'WAITING' ? 'bg-yellow-100 text-yellow-700 border-yellow-300 animate-pulse' :
                                l.mode === 'X' ? 'bg-red-100 text-red-700 border-red-200' : 'bg-blue-100 text-blue-700 border-blue-200'
                                }`}>
                                {l.trxId === 'trx_A' ? 'A' : 'B'}:{l.mode}
                              </span>
                            ))}
                            {rowLocks.length === 0 && <span className="text-slate-300">-</span>}
                          </div>
                        </td>
                        <td className={`p-2 text-right font-mono border-l border-slate-200 bg-purple-50/30 ${isDirtyA ? 'text-amber-600 font-bold' : 'text-slate-600'}`}>{valA}</td>
                        <td className={`p-2 text-right font-mono border-l border-slate-200 bg-amber-50/30 ${isDirtyB ? 'text-amber-600 font-bold' : 'text-slate-600'}`}>{valB}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 水平分割条 1 */}
          <div
            className="h-1 bg-slate-200 hover:bg-purple-400 cursor-row-resize flex items-center justify-center z-10 transition-colors group relative"
            onMouseDown={startDrag('inventory')}
          >
            <div className="w-8 h-3 bg-white border border-slate-300 rounded-full flex items-center justify-center absolute group-hover:border-purple-400 shadow-sm">
              <GripHorizontal size={10} className="text-slate-400 group-hover:text-purple-500" />
            </div>
          </div>

          {/* 2. 锁监控 (Middle) */}
          <div style={{ height: `${rightMiddleHeight}%` }} className="flex flex-col border-b border-slate-200 bg-white min-h-[100px]">
            <div className="p-2 px-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center shadow-sm shrink-0 h-9">
              <h3 className="font-bold text-slate-700 flex items-center gap-2 text-xs">
                <Activity size={12} className="text-purple-600" /> 锁监控 (data_locks)
              </h3>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs text-left border-collapse font-mono">
                <thead className="bg-slate-100 text-slate-500 sticky top-0 shadow-sm">
                  <tr>
                    <th className="p-2 pl-4 border-b border-slate-200">TRX_ID</th>
                    <th className="p-2 border-b border-slate-200">MODE</th>
                    <th className="p-2 border-b border-slate-200">STATUS</th>
                    <th className="p-2 border-b border-slate-200">RESOURCE_ID</th>
                  </tr>
                </thead>
                <tbody>
                  {locks.length === 0 && (
                    <tr><td colSpan={4} className="p-8 text-center text-slate-400 italic">No Active Locks</td></tr>
                  )}
                  {locks.map((l, i) => (
                    <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className={`p-2 pl-4 ${l.trxId === 'trx_A' ? 'text-purple-600' : 'text-amber-600'}`}>{l.trxId}</td>
                      <td className={`p-2 font-bold ${l.mode === 'X' ? 'text-red-600' : 'text-blue-600'}`}>{l.mode}</td>
                      <td className="p-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] ${l.status === 'GRANTED' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700 animate-pulse'}`}>
                          {l.status}
                        </span>
                      </td>
                      <td className="p-2 text-slate-600">{l.resourceId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 水平分割条 2 */}
          <div
            className="h-1 bg-slate-200 hover:bg-purple-400 cursor-row-resize flex items-center justify-center z-10 transition-colors group relative"
            onMouseDown={startDrag('locks')}
          >
            <div className="w-8 h-3 bg-white border border-slate-300 rounded-full flex items-center justify-center absolute group-hover:border-purple-400 shadow-sm">
              <GripHorizontal size={10} className="text-slate-400 group-hover:text-purple-500" />
            </div>
          </div>

          {/* 3. 控制台 (Bottom - 改为白色风格) */}
          <div className="flex-1 flex flex-col bg-white min-h-[100px]">
            <div className="p-2 px-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center h-9 shrink-0">
              <h3 className="font-bold text-slate-700 flex items-center gap-2 text-xs font-mono">
                <Terminal size={12} className="text-slate-500" /> 控制台输出 (General Log)
              </h3>
            </div>
            <div className="flex-1 p-2 overflow-y-auto font-mono text-[10px] flex flex-col-reverse bg-white">
              {logs.map(log => (
                <div key={log.id} className="flex gap-2 hover:bg-slate-50 px-1 py-0.5 rounded leading-tight border-b border-slate-50 last:border-0">
                  <span className="text-slate-400 w-14 shrink-0 opacity-70">[{log.time}]</span>
                  <span className={`font-bold w-12 text-right shrink-0 ${log.source === 'A' ? 'text-purple-600' : log.source === 'B' ? 'text-amber-600' : 'text-red-600'}`}>
                    {log.source}:
                  </span>
                  <span className={
                    log.type === 'error' ? 'text-red-600' :
                      log.type === 'warn' ? 'text-amber-600' :
                        log.type === 'success' ? 'text-green-600' :
                          log.type === 'sql' ? 'text-blue-600 font-bold' :
                            log.type === 'result' ? 'text-slate-500' :
                              'text-slate-700'
                  }>
                    {log.message}
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default MySQLMonitorV3;
