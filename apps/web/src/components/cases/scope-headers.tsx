"use client";

interface ScopeHeadersProps {
	entities: { id: string; name: string; emailCount: number }[];
	activeEntityId: string | null;
	onEntityChange: (entityId: string | null) => void;
}

export function ScopeHeaders({
	entities,
	activeEntityId,
	onEntityChange,
}: ScopeHeadersProps) {
	return (
		<div className="flex flex-wrap gap-2">
			<button
				type="button"
				onClick={() => onEntityChange(null)}
				className={`text-sm font-medium px-3 py-1.5 rounded-full transition ${
					activeEntityId === null
						? "bg-accent text-inverse"
						: "bg-subtle text-secondary hover:bg-gray-200"
				}`}
			>
				All
			</button>
			{entities.map((entity) => (
				<button
					key={entity.id}
					type="button"
					onClick={() =>
						onEntityChange(activeEntityId === entity.id ? null : entity.id)
					}
					className={`text-sm font-medium px-3 py-1.5 rounded-full transition ${
						activeEntityId === entity.id
							? "bg-entity-primary-bg text-entity-primary"
							: "bg-subtle text-secondary hover:bg-gray-200"
					}`}
				>
					{entity.name}
				</button>
			))}
		</div>
	);
}
