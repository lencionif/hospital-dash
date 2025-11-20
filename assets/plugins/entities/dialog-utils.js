// filename: dialog-utils.js
// Utilidades comunes para abrir diálogos de acertijos con opciones (sin prompt).
(function (W) {
  'use strict';

  const DialogUtils = W.DialogUtils || (W.DialogUtils = {});

  function normalizeOptions(options = []) {
    if (!Array.isArray(options)) return [];
    return options.slice(0, 3).map((opt) => String(opt));
  }

  DialogUtils.openRiddleDialog = function openRiddleDialog(payload = {}) {
    const answers = normalizeOptions(payload.options || payload.answers);
    const hintText = payload.hint || (Array.isArray(payload.hints) ? payload.hints.filter(Boolean)[0] : '');
    const correctIndex = Number.isFinite(payload.correctIndex) ? payload.correctIndex : 0;
    const onSuccess = typeof payload.onSuccess === 'function' ? payload.onSuccess : () => {};
    const onFail = typeof payload.onFail === 'function' ? payload.onFail : () => {};
    const onClose = typeof payload.onClose === 'function' ? payload.onClose : () => {};
    const title = payload.title || payload.name || 'NPC';
    const ask = payload.ask || payload.text || '';

    const handleOutcome = (isCorrect) => {
      if (isCorrect) onSuccess();
      else onFail();
      onClose(isCorrect);
    };

    if (W.DialogAPI?.openRiddle) {
      W.DialogAPI.openRiddle({
        id: payload.id || payload.key || `riddle_${Math.random().toString(36).slice(2, 6)}`,
        title,
        ask,
        hints: hintText ? [hintText] : [],
        answers,
        correctIndex,
        portraitCssVar: payload.portraitCssVar,
        allowEsc: payload.allowEsc !== false,
        onSuccess: () => handleOutcome(true),
        onFail: () => handleOutcome(false),
        onClose: () => onClose(false)
      });
      return true;
    }

    if (W.DialogAPI?.open) {
      const buttons = answers.map((label, idx) => ({
        label,
        primary: idx === correctIndex,
        action: () => handleOutcome(idx === correctIndex)
      }));
      W.DialogAPI.open({
        title,
        text: hintText ? `${ask}\n\n${hintText}` : ask,
        portraitCssVar: payload.portraitCssVar,
        buttons,
        pauseGame: payload.pauseGame !== false,
        onClose: () => onClose(false)
      });
      return true;
    }

    if (W.Dialog?.open) {
      W.Dialog.open({
        portrait: payload.portrait,
        text: hintText ? `${ask}\n\n${hintText}` : ask,
        options: answers,
        correct: correctIndex,
        onAnswer: (idx) => handleOutcome(idx === correctIndex)
      });
      return true;
    }

    return false;
  };
})(window);
