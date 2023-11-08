import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

setPanicHook();
const originDoc = new Loro<{ nodes: Node[], edges: Edge[] }>();
const loroNodes = originDoc.getList("nodes");
const loroEdges = originDoc.getList("edges");
let i = 0;
for (const node of initialNodes) {
  const map = loroNodes.insertContainer(i++, "Map");
  map.set("id", node.id);
  const pos = map.insertContainer("position", "Map");
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
      doc.checkout_to_latest();
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
    <div style={{ width: "100%", height: "100vh", position: "relative" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={eq ? onNodesChange : () => { }}
        onEdgesChange={eq ? onEdgesChange : () => { }}
        onConnect={(params) => setEdges((els) => addEdge(params, els))}
        fitView
      >
        <Background />
      </ReactFlow>
      <div style={{ position: "absolute", fontSize: 24, top: 30, width: 400, left: "50%", transform: "translateX(-50%)" }} >
        <div style={{ marginBottom: 16 }}>
          At version {version}. Max version {maxVersion}.
        </div>
        {
          maxVersion > 0 ?
            <Slider value={[version]} max={maxVersion} min={0}
              onValueChange={onChangeVersion} style={{ cursor: "pointer" }} /> :
            undefined
        }
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
    <div style={{ display: "flex", position: "relative", flexDirection: "row" }}>
      <div style={{ borderRight: "2px solid rgba(0, 0, 0, 0.1)", flex: 1 }}>
        <Flow doc={docA} nodes={initialNodes} edges={initialEdges} />
      </div>
      <div style={{ flex: 1 }}>
        <Flow doc={docB} nodes={initialNodes} edges={initialEdges} />
      </div>
      <div style={{
        position: "absolute",
        display: "flex", justifyContent: "center",
        alignItems: "center", flexDirection: "column",
        left: "50%",
        top: 20,
        transform: "translate(-50%, 0%)",
        background: "rgba(255, 255, 255, 0.9)",
        border: "1px solid rgba(200, 200, 200, 0.4)",
        padding: "0px 8px 16px 8px",
        width: 120,
        borderRadius: 4
      }}>
        {connected ?
          <p>
            Connected
          </p> : <p>
            Disconnected
          </p>
        }
        <Switch checked={connected} onCheckedChange={(v: boolean) => {
          if (v) {
            docA.import(docB.exportFrom(docA.version()));
            docB.import(docA.exportFrom(docB.version()));
          }
          connectedRef.current = v;
          setConnected(v);
        }} style={{ cursor: "pointer" }} />
      </div>
    </div>
  );
}

export default App;
