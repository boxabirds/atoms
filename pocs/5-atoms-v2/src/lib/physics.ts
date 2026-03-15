import RAPIER from '@dimforge/rapier3d-compat';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRAVITY_Y = -9.81;
const GROUND_HALF_EXTENT = 10;

// ---------------------------------------------------------------------------
// Physics world
// ---------------------------------------------------------------------------

export interface PhysicsWorld {
  rapier: typeof RAPIER;
  world: RAPIER.World;
  groundCollider: RAPIER.Collider;
}

export async function initPhysics(): Promise<PhysicsWorld> {
  await RAPIER.init();

  const world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });

  // Static ground body
  const groundBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0),
  );
  const groundCollider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(GROUND_HALF_EXTENT, 0.05, GROUND_HALF_EXTENT)
      .setRestitution(0.3)
      .setFriction(0.8),
    groundBody,
  );

  return { rapier: RAPIER, world, groundCollider };
}

export function stepPhysics(pw: PhysicsWorld) {
  pw.world.step();
}
