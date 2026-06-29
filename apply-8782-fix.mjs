import fs from 'node:fs';

const renderUnitPath = 'packages/qwik/src/core/render/dom/render.unit.tsx';
const visitorPath = 'packages/qwik/src/core/render/dom/visitor.ts';

const projectedTaskTest = String.raw`
test('should not run projected component tasks until the slot is rendered', async () => {
  const fixture = new ElementFixture();
  const calls: string[] = [];

  const Child = component$(() => {
    useTask$(() => {
      calls.push('child task');
    });

    useVisibleTask$(() => {
      calls.push('child visible');
    });

    return <div>Child</div>;
  });

  const Layout = component$((props: { loading: boolean }) => {
    if (props.loading) {
      return <div>Loading...</div>;
    }

    return <Slot />;
  });

  const App = component$(() => {
    const loading = useSignal(true);

    return (
      <div>
        <button onClick$={() => (loading.value = false)}>show</button>
        <Layout loading={loading.value}>
          <Child />
        </Layout>
      </div>
    );
  });

  await render(fixture.host, <App />);

  await expectRendered(
    fixture,
    \`
      <div>
        <button>show</button>
        <div>Loading...</div>
      </div>\`
  );

  assert.deepEqual(calls, []);

  await trigger(fixture.host, 'button', 'click');

  await expectRendered(fixture, \`<div><button>show</button><div>Child</div></div>\`);
  assert.deepEqual(calls, ['child task', 'child visible']);
});
`;

const visitorHelpers = String.raw`
const containsComponentVNode = (vnode: ProcessedJSXNode): boolean => {
  if (vnode.$type$ === VIRTUAL && OnRenderProp in vnode.$props$) {
    return true;
  }

  const children = vnode.$children$;
  for (let i = 0; i < children.length; i++) {
    if (containsComponentVNode(children[i])) {
      return true;
    }
  }

  return false;
};

const shouldDeferProjection = (
  slotMaps: SlotMaps,
  slotName: string,
  newVdom: ProcessedJSXNode
): boolean => {
  return !slotMaps.slots[slotName] && containsComponentVNode(newVdom);
};

const removeParkedTemplate = (
  staticCtx: RenderStaticContext,
  slotMaps: SlotMaps,
  slotName: string
): void => {
  const templateEl = slotMaps.templates[slotName];

  if (templateEl) {
    slotMaps.templates[slotName] = undefined;
    removeNode(staticCtx, templateEl);
  }
};

`;

function updateRenderUnit() {
  let content = fs.readFileSync(renderUnitPath, 'utf8');

  if (content.includes('should not run projected component tasks until the slot is rendered')) {
    console.log(`${renderUnitPath}: test already exists`);
    return;
  }

  const anchor = String.raw`test('should project un-named slot component', async () => {
  const fixture = new ElementFixture();

  await render(
    fixture.host,
    <Project>
      <HelloWorld />
    </Project>
  );
});
`;

  if (!content.includes(anchor)) {
    throw new Error(`Could not find insertion anchor in ${renderUnitPath}`);
  }

  content = content.replace(anchor, `${anchor}\n${projectedTaskTest}\n`);
  fs.writeFileSync(renderUnitPath, content);
  console.log(`${renderUnitPath}: added regression test`);
}

function updateVisitorHelpers() {
  let content = fs.readFileSync(visitorPath, 'utf8');

  if (content.includes('const containsComponentVNode =')) {
    console.log(`${visitorPath}: helpers already exist`);
    return content;
  }

  const anchor = String.raw`const renderContentProjection = (
  rCtx: RenderContext,
  hostCtx: QContext,
  vnode: ProcessedJSXNode,
  flags: number
): ValueOrPromise<void> => {
`;

  if (!content.includes(anchor)) {
    throw new Error(`Could not find renderContentProjection anchor in ${visitorPath}`);
  }

  content = content.replace(anchor, `${visitorHelpers}${anchor}`);
  fs.writeFileSync(visitorPath, content);
  console.log(`${visitorPath}: added projection helpers`);
  return content;
}

function updateRenderContentProjection() {
  let content = fs.readFileSync(visitorPath, 'utf8');

  const alreadyPatched = String.raw`const newVdom = splittedNewChildren[slotName];

      if (shouldDeferProjection(slotMaps, slotName, newVdom)) {
        removeParkedTemplate(staticCtx, slotMaps, slotName);
        return;
      }`;

  if (content.includes(alreadyPatched)) {
    console.log(`${visitorPath}: renderContentProjection already patched`);
    return;
  }

  const anchor = String.raw`const newVdom = splittedNewChildren[slotName];
      const slotCtx = getSlotCtx(`;

  const replacement = String.raw`const newVdom = splittedNewChildren[slotName];

      if (shouldDeferProjection(slotMaps, slotName, newVdom)) {
        removeParkedTemplate(staticCtx, slotMaps, slotName);
        return;
      }

      const slotCtx = getSlotCtx(`;

  if (!content.includes(anchor)) {
    throw new Error(`Could not find renderContentProjection slot anchor in ${visitorPath}`);
  }

  content = content.replace(anchor, replacement);
  fs.writeFileSync(visitorPath, content);
  console.log(`${visitorPath}: patched renderContentProjection`);
}

function updateCreateElmProjection() {
  let content = fs.readFileSync(visitorPath, 'utf8');

  const alreadyPatched = String.raw`const newVnode = splittedNewChildren[slotName];

        if (shouldDeferProjection(slotMap, slotName, newVnode)) {
          removeParkedTemplate(staticCtx, slotMap, slotName);
          continue;
        }`;

  if (content.includes(alreadyPatched)) {
    console.log(`${visitorPath}: createElm projection already patched`);
    return;
  }

  const anchor = String.raw`const newVnode = splittedNewChildren[slotName];
        const slotCtx = getSlotCtx(staticCtx, slotMap, elCtx, slotName, staticCtx.$containerState$);`;

  const replacement = String.raw`const newVnode = splittedNewChildren[slotName];

        if (shouldDeferProjection(slotMap, slotName, newVnode)) {
          removeParkedTemplate(staticCtx, slotMap, slotName);
          continue;
        }

        const slotCtx = getSlotCtx(staticCtx, slotMap, elCtx, slotName, staticCtx.$containerState$);`;

  if (!content.includes(anchor)) {
    throw new Error(`Could not find createElm projection anchor in ${visitorPath}`);
  }

  content = content.replace(anchor, replacement);
  fs.writeFileSync(visitorPath, content);
  console.log(`${visitorPath}: patched createElm projection`);
}

updateRenderUnit();
updateVisitorHelpers();
updateRenderContentProjection();
updateCreateElmProjection();

console.log('Done.');
