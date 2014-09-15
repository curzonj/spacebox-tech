// blueprints and resources come from the tech system
module.exports = {
    "d9c166f0-3c6d-11e4-801e-d5aa4697630f": {
        "name": "Basic Factory",
        "type": "structure",
        "build": {
            "time": 300,
            "resources": {
                "metal": 2
            }
        },
        "production": {
            "manufacture": [{
                "item": "6e573ecc-557b-4e05-9f3b-511b2611c474"
            }]
        }
    },
    "f9e7e6b4-d5dc-4136-a445-d3adffc23bc6": {
        "name": "Metal",
        "type": "resource"
    },
    "de726be0-3c6d-11e4-801e-d5aa4697630f": {
        "name": "Ore",
        "type": "resource",
        "refine": {
            "time": 1,
            "outputs": {
                "metal": 1
            }
        }
    },
    "ffb74468-7162-4bfb-8a0e-a8ae72ef2a8b": {
        "name": "Basic Scaffold",
        "type": "deployable",
        "build": {
            "time": 10,
            "resources": {
                "metal": 1
            }
        },
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
        "build": {
            "time": 30,
            "resources": {
                "metal": 2
            }
        }
    },
    "7abb04d3-7d58-42d8-be93-89eb486a1c67": {
        "name": "Starter Ship",
        "type": "spaceship",
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

        "build": {
            "time": 30,
            "resources": {
                "metal": 20
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
