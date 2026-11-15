// Minimal typings for the parts of three.js the starfield uses (@types/three is not a dependency).
declare module "three" {
  export const AdditiveBlending: number;

  export class Object3D {
    frustumCulled: boolean;
    renderOrder: number;
    onBeforeRender: () => void;
  }

  export class Scene extends Object3D {
    add(object: Object3D): this;
    remove(object: Object3D): this;
  }

  export class Float32BufferAttribute {
    readonly itemSize: number;
    constructor(array: Float32Array, itemSize: number);
  }

  export class BufferGeometry {
    setAttribute(name: string, attribute: Float32BufferAttribute): this;
    dispose(): void;
  }

  export class ShaderMaterial {
    constructor(parameters: {
      uniforms: Record<string, { value: number }>;
      vertexShader: string;
      fragmentShader: string;
      transparent?: boolean;
      depthWrite?: boolean;
      blending?: number;
    });
    dispose(): void;
  }

  export class Points extends Object3D {
    constructor(geometry: BufferGeometry, material: ShaderMaterial);
  }
}
