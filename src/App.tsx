import { SVGProps, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Node,
  Edge,
} from 'reactflow';
import { nodes as initialNodes, edges as initialEdges } from './nodes-edges';
import 'reactflow/dist/style.css';
import { ContainerID, Loro, LoroList, OpId, setPanicHook, } from 'loro-crdt';
import { Slider, Switch } from '@radix-ui/themes';
import "./App.css"

setPanicHook();
const originDoc = new Loro<{ nodes: Node[], edges: Edge[] }>();
const loroNodes = originDoc.getList("nodes");
const loroEdges = originDoc.getList("edges");
let i = 0;
for (const node of initialNodes) {
  const map = loroNodes.insertContainer(i++, "Map");
  map.set("id", node.id);
  const pos = map.setContainer("position", "Map");
  pos.set("x", node.position.x);
  pos.set("y", node.position.y);
  map.set("data", node.data);
}

i = 0;
for (const edge of initialEdges) {
  const map = loroEdges.insertContainer(i++, "Map");
  map.set("id", edge.id);
  map.set("source", edge.source);
  map.set("target", edge.target);
}

originDoc.commit();

const onNodesUpdated = (doc: Loro, loroNodes: LoroList, nodes: Node[], validFrontiers: OpId[][]) => {
  const n = loroNodes.length;
  let del = 0;
  let changed = false;
  for (let i = 0; i + del < n; i++) {
    const nodeId = loroNodes.get(i - del);
    const map = doc.getMap(nodeId as ContainerID);
    const id = map.get("id") as string;
    const source = nodes.find(n => n.id === id);
    if (source == null) {
      loroNodes.delete(i, 1);
      changed = true;
      del += 1;
      continue
    }

    const value: Node = map.getDeepValue();
    const posId = map.get("position");
    const pos = doc.getMap(posId as ContainerID);
    if (value.position.x !== source.position.x || value.position.y !== source.position.y) {
      changed = true;
      pos.set("x", source.position.x);
      pos.set("y", source.position.y);
    }
  }

  if (changed) {
    doc.commit();
    validFrontiers.push(doc.frontiers());
  }
}

function onEdgesUpdated(doc: Loro, loroEdges: LoroList, edges: Edge[], validFrontiers: OpId[][]) {
  if (loroEdges.length === edges.length) {
    return;
  }

  let changed = false;
  const curEdges: Edge[] = loroEdges.getDeepValue();
  let del = 0;
  for (let i = 0; i < curEdges.length; i++) {
    const edge = curEdges[i];
    if (edges.find(e => e.id === edge.id) == null) {
      changed = true;
      loroEdges.delete(i - del, 1);
      del += 1;
    }
  }

  for (const edge of edges) {
    if (curEdges.find(e => e.id === edge.id) == null) {
      // insert new edge
      const map = loroEdges.insertContainer(0, "Map");
      map.set("id", edge.id);
      map.set("source", edge.source);
      map.set("target", edge.target);
      changed = true;
    }
  }

  if (changed) {
    doc.commit();
    validFrontiers.push(doc.frontiers());
  }
}


const Flow = ({ doc, nodes: initNodes, edges: initEdges }: { doc: Loro, nodes: Node[], edges: Edge[] }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState(initNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges);
  const validFrontiersRef = useRef<OpId[][]>([]);
  if (validFrontiersRef.current.length === 0) {
    validFrontiersRef.current.push(doc.frontiers());
  }
  useEffect(() => {
    setNodes(doc.getList("nodes").getDeepValue());
    setEdges(doc.getList("edges").getDeepValue());
    const subId = doc.subscribe(e => {
      if (!e.local) {
        setNodes(doc.getList("nodes").getDeepValue());
        setEdges(doc.getList("edges").getDeepValue());
        if (validFrontiersRef.current[validFrontiersRef.current.length - 1][0] !== doc.frontiers()[0]) {
          validFrontiersRef.current.push(doc.frontiers());
          setMaxVersion(validFrontiersRef.current.length);
          setVersion(validFrontiersRef.current.length);
        }
      }
    });
    return () => {
      doc.unsubscribe(subId);
    }
  }, [doc, setNodes, setEdges]);

  const [version, setVersion] = useState(0);
  const [maxVersion, setMaxVersion] = useState(0);
  const onChangeVersion = useCallback((v: number[]) => {
    const loroNodes = doc.getList("nodes");
    const loroEdges = doc.getList("edges");
    const version = Math.max(v[0], 1) - 1;
    doc.checkout(validFrontiersRef.current[version]);
    if (version == validFrontiersRef.current.length - 1) {
      doc.checkoutToLatest();
    }
    setNodes(loroNodes.getDeepValue());
    setEdges(loroEdges.getDeepValue());
    setVersion(v[0]);
  }, [doc, setEdges, setNodes]);

  const eq = maxVersion == version;
  useEffect(() => {
    if (eq) {
      onNodesUpdated(doc, doc.getList("nodes"), nodes, validFrontiersRef.current);
      setMaxVersion(validFrontiersRef.current.length);
      setVersion(validFrontiersRef.current.length);
    }
  }, [nodes, eq, doc]);

  useEffect(() => {
    if (eq) {
      onEdgesUpdated(doc, doc.getList("edges"), edges, validFrontiersRef.current);
      setMaxVersion(validFrontiersRef.current.length);
      setVersion(validFrontiersRef.current.length);
    }
  }, [edges, eq, doc]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", display: "flex", flexDirection: "column" }}>
      <div style={{ position: "absolute", fontSize: 18, top: 10, width: 360, maxWidth: "calc(100% - 48px)", left: "50%", zIndex: 2, transform: "translateX(-50%)" }} >
        <div style={{ marginBottom: 8 }}>
          At version {version}. Max version {maxVersion}.
        </div>
        {
          maxVersion > 0 ?
            <Slider value={[version]} max={maxVersion} min={0}
              onValueChange={onChangeVersion} style={{ cursor: "pointer" }} /> :
            undefined
        }
      </div>
      <div style={{ flexGrow: 1 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={eq ? onNodesChange : () => { }}
          onEdgesChange={eq ? onEdgesChange : () => { }}
          onConnect={(params) => setEdges((els) => addEdge(params, els))}
          fitViewOptions={{
            padding: 0.4,
          }}
          fitView
        >
          <Background />
        </ReactFlow>
      </div>
    </div>
  );
};

const App = () => {
  const [connected, setConnected] = useState(true);
  const connectedRef = useRef(true);
  const [docA, docB] = useMemo(() => {
    const docA = new Loro();
    const docB = new Loro();
    docA.import(originDoc.exportSnapshot());
    docB.import(originDoc.exportSnapshot());
    docA.subscribe((e) => {
      if (!connectedRef.current) {
        return;
      }
      setTimeout(() => {
        if (e.local && !docA.is_detached()) {
          docB.import(docA.exportFrom(docB.version()));
        }
      })
    })
    docB.subscribe((e) => {
      if (!connectedRef.current) {
        return;
      }
      setTimeout(() => {
        if (e.local && !docA.is_detached()) {
          docA.import(docB.exportFrom(docA.version()));
        }
      });
    })
    return [docA, docB]
  }, [])

  return (
    <div style={{ display: "flex", width: "100%", flexDirection: "column", alignItems: "center" }}>
      <div style={{ display: "flex", paddingLeft: 56, flexDirection: "row", justifyContent: "flex-start", width: "100%", gap: 16, alignItems: "center" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            flexDirection: "row",
            width: 120,
            borderRadius: 4
          }}
        >
          <div style={{ marginRight: 6 }}>
            {connected ?
              <p>
                Connected
              </p> : <p>
                Disconnected
              </p>
            }
          </div>
          <Switch checked={connected} onCheckedChange={(v: boolean) => {
            if (v) {
              docA.import(docB.exportFrom(docA.version()));
              docB.import(docA.exportFrom(docB.version()));
            }
            connectedRef.current = v;
            setConnected(v);
          }} style={{ cursor: "pointer" }} />
        </div>
        <a
          title="GitHub Repo for This Example"
          href="https://github.com/zxch3n/loro-react-flow-example"
          style={{
            fontSize: 32,
            lineHeight: "32px",
          }}
          target='_blank'
        >
          <MdiGithub />
        </a>
        <div>
          <a
            style={{
              left: "50%",
              transform: "translate(-50%, 0%)",
            }}
            href="https://codesandbox.io/p/github/zxch3n/loro-react-flow-example/main?embed=1&file=%2Fsrc%2FApp.tsx"
            target='_blank'
          >
            <PhCodesandboxLogo style={{ fontSize: 32 }} />
          </a>
        </div>
      </div>
      <div style={{ position: "relative", width: "100%", height: "100vh" }} className='container'>
        <div style={{ borderBottom: "2px solid rgba(0, 0, 0, 0.1)", borderRight: "2px solid rgba(0, 0, 0, 0.1)", flexGrow: 1 }}>
          <Flow doc={docA} nodes={initialNodes} edges={initialEdges} />
        </div>
        <div style={{ flexGrow: 1 }}>
          <Flow doc={docB} nodes={initialNodes} edges={initialEdges} />
        </div>
      </div>
    </div>
  );
}

export default App;


export function MdiGithub(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" {...props}><path fill="#000" d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5c.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34c-.46-1.16-1.11-1.47-1.11-1.47c-.91-.62.07-.6.07-.6c1 .07 1.53 1.03 1.53 1.03c.87 1.52 2.34 1.07 2.91.83c.09-.65.35-1.09.63-1.34c-2.22-.25-4.55-1.11-4.55-4.92c0-1.11.38-2 1.03-2.71c-.1-.25-.45-1.29.1-2.64c0 0 .84-.27 2.75 1.02c.79-.22 1.65-.33 2.5-.33c.85 0 1.71.11 2.5.33c1.91-1.29 2.75-1.02 2.75-1.02c.55 1.35.2 2.39.1 2.64c.65.71 1.03 1.6 1.03 2.71c0 3.82-2.34 4.66-4.57 4.91c.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2Z"></path></svg>
  )
}


export function PhCodesandboxLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 256 256" {...props}><path fill="#c8f231" d="m223.68 66.15l-88-48.15a15.94 15.94 0 0 0-15.36 0l-88 48.18a16 16 0 0 0-8.32 14v95.64a16 16 0 0 0 8.32 14l88 48.17a15.88 15.88 0 0 0 15.36 0l88-48.17a16 16 0 0 0 8.32-14V80.18a16 16 0 0 0-8.32-14.03ZM168 152v50.09l-32 17.52v-86.87l80-43.8v32l-43.84 24A8 8 0 0 0 168 152Zm-84.16-7L40 121V89l80 43.8v86.87l-32-17.58V152a8 8 0 0 0-4.16-7Zm-.7-88.41l41 22.45a8 8 0 0 0 7.68 0l41-22.45l34.48 18.87l-79.3 43.42l-79.34-43.44ZM128 32l28.2 15.44L128 62.89L99.8 47.45ZM40 139.22l32 17.52v36.59l-32-17.51Zm144 54.11v-36.59l32-17.52v36.6Z"></path></svg>
  )
}
