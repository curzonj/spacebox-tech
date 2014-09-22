// blueprints and resources come from the tech system
module.exports = {
    "d9c166f0-3c6d-11e4-801e-d5aa4697630f": {
        "name": "Basic Factory",
        "type": "structure",
        "inventory_capacity": 500, // m3
        "hanger_capacity": 2000, // tonnes, megagrams, 1000kg
        "build": {
            "time": 300,
            "resources": {
                "f9e7e6b4-d5dc-4136-a445-d3adffc23bc6": 2
            }
        },
        "production": {
            "manufacture": [{
                "item": "6e573ecc-557b-4e05-9f3b-511b2611c474"
            }, {
                "item": "ffb74468-7162-4bfb-8a0e-a8ae72ef2a8b"
            }]
        }
    },
    "f9e7e6b4-d5dc-4136-a445-d3adffc23bc6": {
        "name": "Metal",
        "volume": 1,
        "type": "resource"
    },
    "de726be0-3c6d-11e4-801e-d5aa4697630f": {
        "name": "Ore",
        "type": "resource",
        "volume": 5,
        "refine": {
            "time": 1,
            "outputs": {
                "f9e7e6b4-d5dc-4136-a445-d3adffc23bc6": 1
            }
        }
    },
    "ffb74468-7162-4bfb-8a0e-a8ae72ef2a8b": {
        "name": "Basic Scaffold",
        "type": "deployable",
        "volume": 20,
        "build": {
            "time": 2, // should be 10 atm
            "resources": {
                "f9e7e6b4-d5dc-4136-a445-d3adffc23bc6": 1
            }
        },
        "inventory_capacity": 10, // m3
        "production": {
            "construct": [{
                "item": "33e24278-4d46-4146-946e-58a449d5afae"
            }, {
                "item": "d9c166f0-3c6d-11e4-801e-d5aa4697630f"
            }]
        }
    },
    "33e24278-4d46-4146-946e-58a449d5afae": {
        "name": "Ore mine",
        "type": "structure",
        "inventory_capacity": 1000,
        "production": {
            "generate": {
                "type": "de726be0-3c6d-11e4-801e-d5aa4697630f",
                "period": 2,
                "quantity": 5
                /* These are the tech functions for this
                "functions": {
                    "output":     [ [ 1, 0.4 ], [ 20, 0 ] ],
                    "capacity":   [ [ 1, 0.4 ], [ 20, 0 ] ],
                    "shields":    [ [ 1, 0.4 ], [ 20, 0 ] ],
                    "structural": [ [ 1, 0.4 ], [ 20, 0 ] ],
                    "build_time": [ [ 1, 0.4 ], [ 20, 0 ] ]
                    // there should be incentive to do fewer bigger
                    // upgrades that take longer. It requires pacience
                    // and planning vs the quick win of a short upgrade
                }
                */
            }
        },
        "build": {
            "time": 3, // should be 30 atm
            "resources": {
                "f9e7e6b4-d5dc-4136-a445-d3adffc23bc6": 2
            }
        }
    },
    "7abb04d3-7d58-42d8-be93-89eb486a1c67": {
        "name": "Starter Ship",
        "type": "spaceship",
        "inventory_capacity": 100,
        "production": {
            "manufacture": [{
                "item": "ffb74468-7162-4bfb-8a0e-a8ae72ef2a8b"
            }],
            "refine": [{
                "item": "de726be0-3c6d-11e4-801e-d5aa4697630f"
            }]
        }
    },
    "6e573ecc-557b-4e05-9f3b-511b2611c474": {
        // TODO lots of this data doesn't belong in the blueprint
        "name": "Basic Fighter",
        "maxHealth": 30,
        "health": 30,
        "health_pct": 100,
        "damage": 1,

        "type": "spaceship",
        "volume": 100,
        "build": {
            "time": 30,
            "resources": {
                "f9e7e6b4-d5dc-4136-a445-d3adffc23bc6": 20
            }
        },

        "position": {
            "x": 0,
            "y": 0,
            "z": 0
        },
        "velocity": {
            "x": 0,
            "y": 0,
            "z": 0
        },
        "facing": {
            "x": 0,
            "y": 0,
            "z": 0,
            "w": 1
        },

        "subsystems": ["engines", "weapon"],
        "effects": {},
        "engine": {
            "maxVelocity": 1.0,
            "maxTheta": Math.PI / 10,
            "maxThrust": 0.1,
            "state": "none" // orbit, approach, etc OR manual
        },
        "weapon": {
            "state": "none"
        }
    }
};
