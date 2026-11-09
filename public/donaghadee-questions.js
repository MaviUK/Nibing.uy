// Native disclosures keep every answer usable without JavaScript.
(() => {
  const root = document.getElementById('questions');
  if (!root) return;
  const buttons = Array.from(root.querySelectorAll('[data-topic]'));
  const panels = Array.from(root.querySelectorAll('[data-topic-panel]'));
  function chooseTopic(id) {
    buttons.forEach(button => {
      const selected = button.dataset.topic === id;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('n64-help-topic--active', selected);
    });
    panels.forEach(panel => {
      panel.hidden = panel.dataset.topicPanel !== id;
      panel.querySelectorAll('details').forEach(answer => { answer.open = false; });
    });
  }
  buttons.forEach(button => button.addEventListener('click', () => {
    if (button.getAttribute('aria-pressed') !== 'true') chooseTopic(button.dataset.topic);
  }));
  root.querySelectorAll('details').forEach(answer => answer.addEventListener('toggle', () => {
    answer.classList.toggle('n64-help-answer--open', answer.open);
    answer.querySelector('.n64-help-answer__toggle').textContent = answer.open ? '−' : '+';
    if (answer.open) root.querySelectorAll('details[open]').forEach(other => {
      if (other !== answer) other.open = false;
    });
  }));
  chooseTopic('pricing');
  root.querySelector('[data-topic-controls]').hidden = false;
})();
