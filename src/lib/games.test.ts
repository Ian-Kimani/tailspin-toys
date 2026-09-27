import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase } from '../../db/test-helpers';
import { categories, publishers, games } from '../../db/schema';
import type { Database } from './db';
import {
    getAllGames,
    getAllGameIds,
    getGameById,
} from './games';

async function seedGames(db: Database, count: number): Promise<void> {
    const [strategy] = await db
        .insert(categories)
        .values({ name: 'Strategy', description: 'strategy' })
        .returning({ id: categories.id });
    const [adventure] = await db
        .insert(categories)
        .values({ name: 'Adventure', description: 'adventure' })
        .returning({ id: categories.id });
    const [pubOne] = await db
        .insert(publishers)
        .values({ name: 'Pub One', description: 'pub' })
        .returning({ id: publishers.id });
    const [pubTwo] = await db
        .insert(publishers)
        .values({ name: 'Pub Two', description: 'pub' })
        .returning({ id: publishers.id });

    // Insert titles in reverse-alphabetical order to prove ordering is applied.
    for (let i = count; i >= 1; i--) {
        await db.insert(games).values({
            title: `Game ${String(i).padStart(2, '0')}`,
            description: `Description ${i}`,
            starRating: 4.2,
            categoryId: i % 2 === 0 ? adventure.id : strategy.id,
            publisherId: i % 2 === 0 ? pubTwo.id : pubOne.id,
        });
    }
}

describe('games data-access helpers', () => {
    let db: Database;

    beforeEach(async () => {
        db = await createTestDatabase();
    });

    it('returns all games ordered by title', async () => {
        await seedGames(db, 3);
        const all = await getAllGames(db);
        expect(all.map((g) => g.title)).toEqual(['Game 01', 'Game 02', 'Game 03']);
        expect(all[0].category).toEqual({ id: expect.any(Number), name: 'Strategy' });
        expect(all[0].publisher).toEqual({ id: expect.any(Number), name: 'Pub One' });
    });

    it('filters by any selected category', async () => {
        await seedGames(db, 4);
        const all = await getAllGames(db);
        const strategyId = all[0].category?.id;
        const adventureId = all[1].category?.id;

        const oneCategory = await getAllGames(db, { categoryIds: [strategyId!] });
        expect(oneCategory).toHaveLength(2);

        const filtered = await getAllGames(db, {
            categoryIds: [strategyId!, adventureId!],
        });

        expect(filtered).toHaveLength(4);
    });

    it('filters by publisher and combines it with categories', async () => {
        await seedGames(db, 4);
        const all = await getAllGames(db);
        const strategyId = all[0].category?.id;
        const publisherId = all[0].publisher?.id;

        const filtered = await getAllGames(db, {
            categoryIds: [strategyId!],
            publisherId: publisherId!,
        });

        expect(filtered).toHaveLength(2);
        expect(filtered.every((game) => game.category?.id === strategyId)).toBe(true);
        expect(filtered.every((game) => game.publisher?.id === publisherId)).toBe(true);
    });

    it('returns no games when filters have no matches', async () => {
        await seedGames(db, 2);
        const filtered = await getAllGames(db, { publisherId: 99999 });
        expect(filtered).toEqual([]);
    });

    it('returns all game ids ordered by title', async () => {
        await seedGames(db, 3);
        const ids = await getAllGameIds(db);
        const all = await getAllGames(db);
        expect(ids).toEqual(all.map((g) => g.id));
    });

    it('fetches a single game by id', async () => {
        await seedGames(db, 2);
        const ids = await getAllGameIds(db);
        const game = await getGameById(db, ids[0]);
        expect(game?.title).toBe('Game 01');
    });

    it('returns null for a non-existent game', async () => {
        await seedGames(db, 2);
        expect(await getGameById(db, 99999)).toBeNull();
    });
});
