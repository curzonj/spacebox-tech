'use strict';

var Q = require('q'),
    inventory = require('../inventory'),
    db = require('spacebox-common-native').db,
    C = require('spacebox-common')

function updateInventory(action, uuid, slice, items, db) {
    return db.inventory.getForUpdateOrFail(uuid, db).
    then(function(container) {
        var args

        if (!Array.isArray(items))
            items = [items]

        switch (action) {
            case 'produce':
                args = [null, null, container, slice]
                break;
            case 'consume':
                args = [container, slice, null, null]
                break;
            default:
                throw new Error("invalid inventory action: " + action)
        }

        Q.all(items.map(function(item) {
            return db.blueprints.get(item.blueprint).
            then(function(blueprint) {
                return {
                    blueprint: blueprint,
                    quantity: item.quantity
                }
            })
        })).then(function(list) {
            args.push(list, db)
        }).then(function() {
            return inventory.transfer.apply(inventory, args).tap(function() {
                db.ctx.old_debug('build', 'contents after', action, container.doc.contents)
            })
        })
    })
}


var self = module.exports = {
    produce: function(uuid, slice, items, db) {
        return updateInventory('produce', uuid, slice, items, db)
    },

    consume: function(uuid, slice, items, db) {
        return updateInventory('consume', uuid, slice, items, db)
    },


    consumeBuildResources: function(quantity, build, container, container_slice, ctx, db) {
        return self.consume(container.id, container_slice,
            Object.keys(build.resources).map(function(key) {
                return {
                    blueprint: key,
                    quantity: quantity * build.resources[key]
                }
            }), db)
    },

    prepareRefit: function(target, modules, container, container_slice, ctx, db) {
        var list = modules.map(function(m) {
            return m.uuid
        })
        var changes = C.compute_array_changes(target.doc.modules, list)

        target.doc.modules = changes.removed.reduce(function(acc, uuid) {
            var i = acc.indexOf(uuid)
            return acc.splice(i, 1)
        }, target.doc.modules)

        target.doc.usage = changes.removed.reduce(function(acc, uuid, i) {
            var blueprint = C.find(modules, {
                uuid: uuid
            })
            return (acc - blueprint.size)
        }, target.doc.usage)

        ctx.old_debug('build', "updated modules", target.doc.modules)
        ctx.old_debug('build', "updated inventory", target.doc.contents)

        return db.inventory.update(target.id, target.doc, db).
        then(function() {
            return self.produce(container.id, container_slice, changes.removed.map(function(key) {
                return {
                    blueprint: key,
                    quantity: 1
                }
            }), db)
        }).then(function() {
            return self.consume(container.id, container_slice, changes.added.map(function(key) {
                return {
                    blueprint: key,
                    quantity: 1
                }
            }), db)
        })
    }

}
